import { HandleOwnerType, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveHandleNameForOwner, resolveUserIdFromHandle } from "@/lib/handle-registry";
import type { AttestationType } from "@/lib/attestations/definitions";

export const runtime = "nodejs";

type AttestationEntry = {
  id: string;
  type: AttestationType;
  confidence: number | null;
  direction: "given" | "received";
  createdAt: Date;
  /** The other party: who gave it (received) or who it was given to (given). */
  peer: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
    avatarUrl: string | null;
  };
};

type GetUserOk = {
  user: {
    id: string;
    handle: string | null;
    name: string | null;
    image: string | null;
    avatarUrl: string | null;
    headline: string | null;
    bio: string | null;
    location: string | null;
    links: string[] | null;
    skills: string[] | null;
    tags: string[] | null;
    languages: string[] | null;
    contactPreference: string | null;
    discordId: string | null;
    discordHandle: string | null;
    twitterHandle: string | null;
    githubHandle: string | null;
    walletAddresses: string[];
    createdAt: Date;
    lastActiveAt: Date | null;
  };
  isSelf: boolean;
  attestations: AttestationEntry[];
};

const QuerySchema = z.object({
  userId: z.string().min(1).optional(),
  handle: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const actorId = session?.user?.id ?? null;

    const sp = req.nextUrl.searchParams;
    const parsed = QuerySchema.safeParse({
      userId: sp.get("userId") ?? undefined,
      handle: sp.get("handle") ?? undefined,
    });

    if (!parsed.success) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Invalid request",
        status: 400,
        issues: parsed.error.issues.map((iss) => ({
          path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
          message: iss.message,
        })),
      });
    }

    const input = parsed.data;
    const handleInput = input.handle; // raw user input

    // Public endpoint: require an explicit identifier. (No session required.)
    if (!input.userId && !handleInput) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Provide either userId or handle",
        status: 400,
      });
    }

    // Resolve target user id (prefer explicit ids; support handle for public lookup).
    let targetUserId: string | null = input.userId ?? null;

    if (!targetUserId && handleInput) {
      const resolved = await resolveUserIdFromHandle(handleInput);
      if (!resolved.ok) return errJson(resolved.error);
      targetUserId = resolved.value;
    }

    // If we still don't have a target id, treat as not found (public lookup).
    if (!targetUserId) {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }

    const user = await db.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        image: true,
        avatarUrl: true,
        headline: true,
        bio: true,
        location: true,
        links: true,
        skills: true,
        tags: true,
        languages: true,
        contactPreference: true,
        discordId: true,
        discordHandle: true,
        twitterHandle: true,
        githubHandle: true,
        wallets: { select: { address: true }, orderBy: { createdAt: "desc" as const } },
        createdAt: true,
        lastActiveAt: true,
      },
    });

    if (!user) {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }

    const handleName = await resolveHandleNameForOwner({ ownerType: HandleOwnerType.USER, ownerId: user.id });

    const attestationSelect = {
      id: true,
      type: true,
      confidence: true,
      createdAt: true,
      fromUser: { select: { id: true, name: true, image: true, avatarUrl: true } },
      toUser: { select: { id: true, name: true, image: true, avatarUrl: true } },
    } as const;

    const [receivedRaw, givenRaw] = await Promise.all([
      db.attestation.findMany({
        where: { toUserId: user.id, revokedAt: null },
        take: 50,
        orderBy: { createdAt: "desc" },
        select: attestationSelect,
      }),
      db.attestation.findMany({
        where: { fromUserId: user.id, revokedAt: null },
        take: 50,
        orderBy: { createdAt: "desc" },
        select: attestationSelect,
      }),
    ]);

    // Collect all peer user IDs to resolve handles in one batch
    const peerIds = new Set<string>();
    for (const a of receivedRaw) peerIds.add(a.fromUser.id);
    for (const a of givenRaw) peerIds.add(a.toUser.id);

    const peerHandlePairs = await Promise.all(
      Array.from(peerIds).map(async (id) => {
        const h = await resolveHandleNameForOwner({ ownerType: HandleOwnerType.USER, ownerId: id });
        return [id, h] as const;
      }),
    );

    const peerHandles = new Map(peerHandlePairs);

    const received: AttestationEntry[] = receivedRaw.map((a) => ({
      id: a.id,
      type: a.type as AttestationType,
      confidence: a.confidence,
      direction: "received",
      createdAt: a.createdAt,
      peer: {
        id: a.fromUser.id,
        name: a.fromUser.name,
        handle: peerHandles.get(a.fromUser.id) ?? null,
        image: a.fromUser.image,
        avatarUrl: a.fromUser.avatarUrl,
      },
    }));

    const given: AttestationEntry[] = givenRaw.map((a) => ({
      id: a.id,
      type: a.type as AttestationType,
      confidence: a.confidence,
      direction: "given",
      createdAt: a.createdAt,
      peer: {
        id: a.toUser.id,
        name: a.toUser.name,
        handle: peerHandles.get(a.toUser.id) ?? null,
        image: a.toUser.image,
        avatarUrl: a.toUser.avatarUrl,
      },
    }));

    // Merge and sort chronologically (newest first)
    const attestations: AttestationEntry[] = [...received, ...given]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return okJson<GetUserOk>({
      user: {
        id: user.id,
        handle: handleName,
        name: user.name,
        image: user.image,
        avatarUrl: user.avatarUrl,
        headline: user.headline,
        bio: user.bio,
        location: user.location,
        links: user.links,
        skills: user.skills,
        tags: user.tags,
        languages: user.languages,
        contactPreference: user.contactPreference,
        discordId: user.discordId,
        discordHandle: user.discordHandle,
        twitterHandle: user.twitterHandle,
        githubHandle: user.githubHandle,
        walletAddresses: user.wallets.map((w) => w.address),
        createdAt: user.createdAt,
        lastActiveAt: user.lastActiveAt,
      },
      isSelf: actorId === user.id,
      attestations,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }

    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

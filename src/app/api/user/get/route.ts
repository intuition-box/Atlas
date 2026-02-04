import { HandleOwnerType, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveHandleNameForOwner, resolveUserIdFromHandle } from "@/lib/handle-registry";
import type { AttestationType } from "@/config/attestations";

export const runtime = "nodejs";

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
    createdAt: Date;
  };
  isSelf: boolean;
  attestations: Array<{
    id: string;
    type: AttestationType;
    confidence: number | null;
    createdAt: Date;
    fromUser: {
      id: string;
      name: string | null;
      handle: string | null;
      image: string | null;
      avatarUrl: string | null;
    };
  }>;
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
        createdAt: true,
      },
    });

    if (!user) {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }

    const handleName = await resolveHandleNameForOwner({ ownerType: HandleOwnerType.USER, ownerId: user.id });

    const rawAttestations = await db.attestation.findMany({
      where: {
        toUserId: user.id,
        revokedAt: null, // Only active attestations
      },
      take: 50,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        confidence: true,
        createdAt: true,
        fromUser: {
          select: {
            id: true,
            name: true,
            image: true,
            avatarUrl: true,
          },
        },
      },
    });

    const fromUserIds = Array.from(new Set(rawAttestations.map((a) => a.fromUser.id)));

    const fromUserHandlePairs = await Promise.all(
      fromUserIds.map(async (id) => {
        const h = await resolveHandleNameForOwner({ ownerType: HandleOwnerType.USER, ownerId: id });
        return [id, h] as const;
      }),
    );

    const fromUserHandles = new Map(fromUserHandlePairs);

    const attestations: GetUserOk["attestations"] = rawAttestations.map((a) => ({
      id: a.id,
      type: a.type as AttestationType,
      confidence: a.confidence,
      createdAt: a.createdAt,
      fromUser: {
        id: a.fromUser.id,
        name: a.fromUser.name,
        handle: fromUserHandles.get(a.fromUser.id) ?? null,
        image: a.fromUser.image,
        avatarUrl: a.fromUser.avatarUrl,
      },
    }));

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
        createdAt: user.createdAt,
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

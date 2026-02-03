import { MembershipRole, MembershipStatus, ScoringType } from "@prisma/client";
import { z } from "zod";

import type { NextRequest } from "next/server";

import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { requireAuth } from "@/lib/auth/policy";
import { resolveCommunityIdFromHandle } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type JoinCommunityOk = {
  communityId: string;
  membershipId: string;
  status: MembershipStatus;
};

const JoinCommunitySchema = z
  .object({
    communityId: z.string().min(1).optional(),
    handle: z.string().min(1).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => Boolean(v.communityId || v.handle), {
    message: "communityId or handle is required",
    path: ["communityId"],
  });

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const csrf = requireCsrf(req);
    if (!csrf.ok) return errJson(csrf.error);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return errJson({ code: "INVALID_REQUEST", message: "Invalid JSON", status: 400 });
    }

    const parsed = JoinCommunitySchema.safeParse(raw);
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

    let communityId: string | null = input.communityId ?? null;

    if (!communityId && input.handle) {
      const resolved = await resolveCommunityIdFromHandle(input.handle);
      if (!resolved.ok) return errJson(resolved.error);
      communityId = resolved.value;
    }

    if (!communityId) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    const community = await db.community.findUnique({
      where: { id: communityId },
      select: {
        id: true,
        isMembershipOpen: true,
      },
    });

    if (!community) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    if (!community.isMembershipOpen) {
      return errJson({
        code: "APPLICATION_CLOSED",
        message: "This community is not accepting new members.",
        status: 409,
      });
    }

    const now = new Date();

    const existing = await db.membership.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: { id: true, status: true },
    });

    if (existing) {
      if (existing.status === MembershipStatus.BANNED) {
        return errJson({ code: "FORBIDDEN", message: "You are banned from this community.", status: 403 });
      }

      // Repeated joins update activity timestamp, but do not create additional JOINED scoring events.
      await db.membership.update({
        where: { id: existing.id },
        data: { lastActiveAt: now },
        select: { id: true },
      });

      return okJson<JoinCommunityOk>({
        communityId,
        membershipId: existing.id,
        status: existing.status,
      });
    }

    // Create a pending membership request and record a single JOINED scoring event.
    // Scores default to 0; role/status are explicit.
    const created = await db.$transaction(async (tx) => {
      const membership = await tx.membership.create({
        data: {
          userId,
          communityId,
          role: MembershipRole.MEMBER,
          status: MembershipStatus.PENDING,
          lastActiveAt: now,
          ...(input.note ? { note: input.note } : {}),
        },
        select: { id: true, status: true },
      });

      await tx.scoringEvent.create({
        data: {
          communityId,
          actorId: userId,
          type: ScoringType.JOINED,
          // Keep metadata minimal; we can expand later if needed.
        },
        select: { id: true },
      });

      return membership;
    });

    return okJson<JoinCommunityOk>({
      communityId,
      membershipId: created.id,
      status: created.status,
    });
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

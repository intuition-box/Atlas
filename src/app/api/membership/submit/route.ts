import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { MembershipRole, MembershipStatus, OrbitLevel } from "@prisma/client";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveCommunityIdFromHandle } from "@/lib/handle-registry";
import { recomputeMemberScores } from "@/lib/scoring";
import { requireCsrf } from "@/lib/security/csrf";
import { MembershipSubmitSchema } from "@/lib/validations";

export const runtime = "nodejs";

type SubmitOk = {
  submitted: true;
  created: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const csrf = await requireCsrf(req);
    if (csrf instanceof Response) return csrf;

    const json = await req.json().catch(() => null);

    // Prefer ids. If the client sends a handle, resolve it once here and validate the resolved payload.
    let payload: unknown = json;
    if (payload && typeof payload === "object") {
      const v = payload as Record<string, unknown>;
      const hasCommunityId = typeof v.communityId === "string" && v.communityId.trim().length > 0;
      const communityHandle = typeof v.communityHandle === "string" ? v.communityHandle.trim() : "";

      if (!hasCommunityId && communityHandle) {
        const resolved = await resolveCommunityIdFromHandle(communityHandle);
        if (!resolved.ok) return errJson(resolved.error);
        payload = { ...v, communityId: resolved.value };
      }
    }

    const parsed = await MembershipSubmitSchema.safeParseAsync(payload);

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

    const body = parsed.data;
    const communityId = body.communityId;

    const community = await db.community.findUnique({
      where: { id: communityId },
      select: { id: true, isMembershipOpen: true },
    });

    if (!community) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    if (!community.isMembershipOpen) {
      return errJson({
        code: "FORBIDDEN",
        message: "This community is not accepting new members.",
        status: 403,
      });
    }

    const existingMember = await db.membership.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: { status: true },
    });

    if (existingMember?.status === MembershipStatus.APPROVED) {
      return errJson({
        code: "CONFLICT",
        message: "You are already approved in this community.",
        status: 409,
      });
    }

    if (existingMember?.status === MembershipStatus.BANNED) {
      return errJson({
        code: "FORBIDDEN",
        message: "You are banned from this community.",
        status: 403,
      });
    }

    const now = new Date();

    const result = await db.$transaction(async (tx) => {
      // Ensure membership exists (or is reset back to PENDING).
      await tx.membership.upsert({
        where: { userId_communityId: { userId, communityId } },
        create: {
          userId,
          communityId,
          status: MembershipStatus.PENDING,
          role: MembershipRole.MEMBER,
          orbitLevel: OrbitLevel.EXPLORER,
          lastActiveAt: now,
        },
        update: {
          status: MembershipStatus.PENDING,
          lastActiveAt: now,
        },
        select: { id: true },
      });

      const prev = await tx.application.findUnique({
        where: { userId_communityId: { userId, communityId } },
        select: { id: true },
      });

      await tx.application.upsert({
        where: { userId_communityId: { userId, communityId } },
        create: {
          userId,
          communityId,
          status: MembershipStatus.PENDING,
          answers: body.answers as unknown as Prisma.InputJsonValue,
        },
        update: {
          status: MembershipStatus.PENDING,
          answers: body.answers as unknown as Prisma.InputJsonValue,
          reviewerId: null,
          reviewedAt: null,
          reviewNote: null,
        },
        select: { id: true },
      });

      // NOTE: application submission is not a scoring event. (ScoringEvent/ScoringType)
      return { created: !prev };
    });

    // Keep recompute outside the transaction.
    // Best-effort: application submission itself shouldn't score, but membership state changes
    // and downstream calculations can depend on being in-sync.
    try {
      await recomputeMemberScores({ communityId, userId });
    } catch {
      // Ignore scoring failures; submission is already committed.
    }

    return okJson<SubmitOk>({ submitted: true, created: result.created });
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}
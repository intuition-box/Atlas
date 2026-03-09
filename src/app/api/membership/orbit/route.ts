import {
  MembershipRole,
  MembershipStatus,
  OrbitLevel,
  Prisma,
  EventType,
} from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveCommunityIdFromHandle, resolveUserIdFromHandle } from "@/lib/handle-registry";
import { hasPermission } from "@/lib/permissions";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type SetOrbitOk = {
  membership: {
    id: string;
    userId: string;
    communityId: string;
    orbitLevel: OrbitLevel;
    orbitLevelOverride: OrbitLevel | null;
  };
  changed: boolean;
};

const SetOrbitSchema = z
  .object({
    communityId: z.string().trim().min(1).optional(),
    communityHandle: z.string().trim().min(1).optional(),

    userId: z.string().trim().min(1).optional(),
    userHandle: z.string().trim().min(1).optional(),

    orbitLevelOverride: z.nativeEnum(OrbitLevel).nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.communityId && !v.communityHandle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["communityId"],
        message: "communityId or communityHandle is required",
      });
    }

    if (!v.userId && !v.userHandle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userId"],
        message: "userId or userHandle is required",
      });
    }
  });

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const actorId = session?.user?.id;

    if (!actorId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const csrf = await requireCsrf(req);
    if (csrf instanceof Response) return csrf;

    const raw = await req.json().catch(() => null);
    const parsed = SetOrbitSchema.safeParse(raw);

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

    let communityId = input.communityId ?? null;
    if (!communityId && input.communityHandle) {
      const resolved = await resolveCommunityIdFromHandle(input.communityHandle);
      if (!resolved.ok) return errJson(resolved.error);
      communityId = resolved.value;
    }

    let userId = input.userId ?? null;
    if (!userId && input.userHandle) {
      const resolved = await resolveUserIdFromHandle(input.userHandle);
      if (!resolved.ok) return errJson(resolved.error);
      userId = resolved.value;
    }

    if (!communityId || !userId) {
      return errJson({ code: "INVALID_REQUEST", message: "Invalid request", status: 400 });
    }

    const result = await db.$transaction(async (tx) => {
      // Actor must be an approved member with "membership.orbit" permission.
      const actorMembership = await tx.membership.findUnique({
        where: { userId_communityId: { userId: actorId, communityId } },
        select: { status: true, role: true },
      });

      if (!actorMembership || actorMembership.status !== MembershipStatus.APPROVED) {
        return { kind: "forbidden" } as const;
      }

      const community = await tx.community.findUnique({
        where: { id: communityId },
        select: { permissions: true },
      });

      if (!hasPermission(actorMembership.role, "membership.orbit", community?.permissions)) {
        return { kind: "forbidden" } as const;
      }

      const membership = await tx.membership.findUnique({
        where: {
          userId_communityId: { userId, communityId },
        },
        select: {
          id: true,
          userId: true,
          communityId: true,
          role: true,
          orbitLevel: true,
          orbitLevelOverride: true,
        },
      });

      if (!membership) {
        return { kind: "not_found" } as const;
      }

      // Owners are always Advocate — cannot be changed
      if (membership.role === MembershipRole.OWNER) {
        return { kind: "owner_locked" } as const;
      }

      const nextOverride = input.orbitLevelOverride;
      const prevOverride = membership.orbitLevelOverride;

      const changed = prevOverride !== nextOverride;
      if (!changed) {
        return { kind: "ok", membership, changed: false } as const;
      }

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: {
          orbitLevelOverride: nextOverride,
          // Keep orbitLevel in sync so all consumers see the effective level
          ...(nextOverride ? { orbitLevel: nextOverride } : {}),
        },
        select: {
          id: true,
          userId: true,
          communityId: true,
          orbitLevel: true,
          orbitLevelOverride: true,
        },
      });

      // Record orbit override change for the activity feed.
      await tx.event.create({
        data: {
          communityId,
          actorId,
          type: EventType.ORBIT_OVERRIDE,
          metadata: {
            subjectUserId: userId,
            orbitLevelOverride: nextOverride,
          },
        },
        select: { id: true },
      });

      return { kind: "ok", membership: updated, changed: true } as const;
    });

    if (result.kind === "forbidden") {
      return errJson({ code: "FORBIDDEN", message: "Insufficient permissions", status: 403 });
    }

    if (result.kind === "owner_locked") {
      return errJson({ code: "FORBIDDEN", message: "Owner orbit level cannot be changed", status: 403 });
    }

    if (result.kind === "not_found") {
      return errJson({ code: "NOT_FOUND", message: "Membership not found", status: 404 });
    }

    let membershipOut = result.membership;

    if (result.changed) {
      // Best-effort recompute so `orbitLevel` reflects the latest scoring + overrides.
      try {
        const mod = await import("@/lib/scoring");
        const recompute =
          (mod as any).recomputeOrbitLevelsForCommunity ??
          (mod as any).recomputeOrbitLevels ??
          (mod as any).recomputeOrbitForCommunity;

        if (typeof recompute === "function") {
          await recompute({ communityId });
        }
      } catch {
        // Ignore recompute failures; membership override is already persisted.
      }

      const fresh = await db.membership.findUnique({
        where: {
          userId_communityId: { userId, communityId },
        },
        select: {
          id: true,
          userId: true,
          communityId: true,
          orbitLevel: true,
          orbitLevelOverride: true,
        },
      });

      if (fresh) membershipOut = fresh;
    }

    return okJson<SetOrbitOk>({
      membership: {
        id: membershipOut.id,
        userId: membershipOut.userId,
        communityId: membershipOut.communityId,
        orbitLevel: membershipOut.orbitLevel,
        orbitLevelOverride: membershipOut.orbitLevelOverride,
      },
      changed: result.changed,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "Membership not found", status: 404 });
    }

    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

import {
  MembershipRole,
  MembershipStatus,
  OrbitLevel,
  Prisma,
  ScoringType,
} from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
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

const SetOrbitSchema = z.object({
  communityId: z.string().min(1, "communityId is required"),
  userId: z.string().min(1, "userId is required"),
  orbitLevelOverride: z.nativeEnum(OrbitLevel).nullable(),
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

    const result = await db.$transaction(async (tx) => {
      // Actor must be an approved owner/admin of the community.
      const actorMembership = await tx.membership.findUnique({
        where: { userId_communityId: { userId: actorId, communityId: input.communityId } },
        select: { status: true, role: true },
      });

      if (!actorMembership || actorMembership.status !== MembershipStatus.APPROVED) {
        return { kind: "forbidden" } as const;
      }

      if (
        actorMembership.role !== MembershipRole.OWNER &&
        actorMembership.role !== MembershipRole.ADMIN
      ) {
        return { kind: "forbidden" } as const;
      }

      const membership = await tx.membership.findUnique({
        where: {
          userId_communityId: { userId: input.userId, communityId: input.communityId },
        },
        select: {
          id: true,
          userId: true,
          communityId: true,
          orbitLevel: true,
          orbitLevelOverride: true,
        },
      });

      if (!membership) {
        return { kind: "not_found" } as const;
      }

      const nextOverride = input.orbitLevelOverride;
      const prevOverride = membership.orbitLevelOverride;

      const changed = prevOverride !== nextOverride;
      if (!changed) {
        return { kind: "ok", membership, changed: false } as const;
      }

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: { orbitLevelOverride: nextOverride },
        select: {
          id: true,
          userId: true,
          communityId: true,
          orbitLevel: true,
          orbitLevelOverride: true,
        },
      });

      // Audit / preferences feed (best-effort): record an orbit override change.
      // We resolve the enum member defensively so this route stays compatible if the enum name changes.
      const orbitOverrideType =
        ((ScoringType as any).ORBIT_OVERRIDE as ScoringType | undefined) ??
        ((ScoringType as any).ORBIT_LEVEL_OVERRIDE as ScoringType | undefined) ??
        ((ScoringType as any).ORBIT_CHANGED as ScoringType | undefined);

      if (orbitOverrideType) {
        await tx.scoringEvent.create({
          data: {
            communityId: input.communityId,
            actorId,
            type: orbitOverrideType,
            metadata: {
              subjectUserId: input.userId,
              orbitLevelOverride: nextOverride,
            },
          },
          select: { id: true },
        });
      }

      return { kind: "ok", membership: updated, changed: true } as const;
    });

    if (result.kind === "forbidden") {
      return errJson({ code: "FORBIDDEN", message: "Insufficient permissions", status: 403 });
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
          await recompute({ communityId: input.communityId });
        }
      } catch {
        // Ignore recompute failures; membership override is already persisted.
      }

      const fresh = await db.membership.findUnique({
        where: {
          userId_communityId: { userId: input.userId, communityId: input.communityId },
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

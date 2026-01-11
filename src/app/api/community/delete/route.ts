import {
  HandleOwnerType,
  HandleStatus,
  MembershipRole,
  MembershipStatus,
  Prisma,
} from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import { DEFAULT_COOLDOWN_DAYS, DEFAULT_RECLAIM_DAYS } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type DeleteCommunityOk = {
  communityId: string;
};

const DeleteCommunitySchema = z.object({
  communityId: z.string().min(1, "communityId is required"),
});

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const csrf = await requireCsrf(req);
    if (csrf instanceof Response) return csrf;

    const raw = await req.json().catch(() => null);
    const parsed = DeleteCommunitySchema.safeParse(raw);

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

    const { communityId } = parsed.data;

    const found = await db.community.findUnique({
      where: { id: communityId },
      select: { id: true },
    });

    if (!found) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    const membership = await db.membership.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: { status: true, role: true },
    });

    if (!membership || membership.status !== MembershipStatus.APPROVED || membership.role !== MembershipRole.OWNER) {
      return errJson({
        code: "FORBIDDEN",
        message: "Only the owner can delete this community",
        status: 403,
      });
    }

    const now = new Date();
    const reclaimUntil = addDays(now, DEFAULT_COOLDOWN_DAYS);
    const availableAt = addDays(reclaimUntil, DEFAULT_RECLAIM_DAYS);

    await db.$transaction(async (tx) => {
      const mapping = await tx.handleOwner.findUnique({
        where: {
          ownerType_ownerId: {
            ownerType: HandleOwnerType.COMMUNITY,
            ownerId: communityId,
          },
        },
        select: { handleId: true },
      });

      if (!mapping) {
        // This should never happen; keep error code stable for clients.
        throw new Error("HANDLE_MAPPING_MISSING");
      }

      const released = await tx.handle.updateMany({
        where: {
          id: mapping.handleId,
          status: HandleStatus.ACTIVE,
        },
        data: {
          status: HandleStatus.RELEASED,
          lastOwnerType: HandleOwnerType.COMMUNITY,
          lastOwnerId: communityId,
          reclaimUntil,
          availableAt,
        },
      });

      if (released.count !== 1) {
        throw new Error("HANDLE_RELEASE_FAILED");
      }

      await tx.handleOwner.deleteMany({
        where: {
          handleId: mapping.handleId,
          ownerType: HandleOwnerType.COMMUNITY,
          ownerId: communityId,
        },
      });

      // Cleanup rows that might use RESTRICT in some schemas.
      await tx.application.deleteMany({ where: { communityId } });
      await tx.membership.deleteMany({ where: { communityId } });
      await tx.scoringEvent.deleteMany({ where: { communityId } });
      await tx.attestation.deleteMany({ where: { communityId } });

      await tx.community.delete({ where: { id: communityId } });
    });

    return okJson<DeleteCommunityOk>({ communityId });
  } catch (e) {
    if (e instanceof Error && e.message === "HANDLE_MAPPING_MISSING") {
      return errJson({
        code: "HANDLE_NOT_AVAILABLE",
        message: "Community handle mapping is missing. Please try again.",
        status: 409,
      });
    }

    if (e instanceof Error && e.message === "HANDLE_RELEASE_FAILED") {
      return errJson({
        code: "HANDLE_NOT_AVAILABLE",
        message: "Community handle could not be released. Please try again.",
        status: 409,
      });
    }

    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

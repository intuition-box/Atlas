import {
  HandleOwnerType,
  MembershipRole,
  MembershipStatus,
  Prisma,
} from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import { releaseOwnerHandle } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type DeleteCommunityOk = {
  communityId: string;
};

const DeleteCommunitySchema = z.object({
  communityId: z.string().min(1, "communityId is required"),
});

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

    const txResult = await db.$transaction(async (tx) => {
      const released = await releaseOwnerHandle(tx, {
        ownerType: HandleOwnerType.COMMUNITY,
        ownerId: communityId,
      });

      if (!released.ok) return released;

      await tx.application.deleteMany({ where: { communityId } });
      await tx.membership.deleteMany({ where: { communityId } });
      await tx.scoringEvent.deleteMany({ where: { communityId } });
      await tx.attestation.deleteMany({ where: { communityId } });

      await tx.community.delete({ where: { id: communityId } });

      return { ok: true as const };
    });

    if ("ok" in txResult && txResult.ok === false) {
      return errJson(txResult.error);
    }

    return okJson<DeleteCommunityOk>({ communityId });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

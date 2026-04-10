import { EventType } from "@prisma/client";
import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const BodySchema = z.object({
  invitationId: z.string().trim().min(1),
});

type AcceptOk = { accepted: true };

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { invitationId } = json;

  const invitation = await db.invitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      communityId: true,
      invitedUserId: true,
      invitedByUserId: true,
      status: true,
      community: { select: { id: true, name: true } },
    },
  });

  if (!invitation) {
    return errJson({ code: "NOT_FOUND", message: "Invitation not found", status: 404 });
  }

  if (invitation.invitedUserId !== viewerId) {
    return errJson({ code: "FORBIDDEN", message: "This invitation is not for you", status: 403 });
  }

  if (invitation.status !== "PENDING") {
    return errJson({ code: "CONFLICT", message: `Invitation is already ${invitation.status.toLowerCase()}`, status: 409 });
  }

  const now = new Date();

  await db.$transaction(async (tx) => {
    // Accept the invitation
    await tx.invitation.update({
      where: { id: invitationId },
      data: { status: "ACCEPTED", acceptedAt: now },
    });

    // Create or update membership — approved directly, bypass application
    await tx.membership.upsert({
      where: {
        userId_communityId: {
          userId: viewerId!,
          communityId: invitation.communityId,
        },
      },
      create: {
        userId: viewerId!,
        communityId: invitation.communityId,
        status: "APPROVED",
        role: "MEMBER",
        approvedAt: now,
        lastActiveAt: now,
      },
      update: {
        status: "APPROVED",
        approvedAt: now,
        lastActiveAt: now,
      },
    });

    // Emit join event
    await tx.event.create({
      data: {
        communityId: invitation.communityId,
        actorId: viewerId!,
        type: EventType.JOINED,
        metadata: { source: "invitation", invitedBy: invitation.invitedByUserId },
      },
    });
  });

  return okJson<AcceptOk>({ accepted: true });
}, { auth: "auth" });

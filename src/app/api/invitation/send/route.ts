import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const BodySchema = z.object({
  communityId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  message: z.string().trim().max(1000).optional(),
});

type SendOk = {
  invitation: { id: string; status: string };
};

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { communityId, userId, message } = json;

  // Verify community exists and viewer is owner/admin
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { id: true, name: true, ownerId: true },
  });

  if (!community) {
    return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  // Check if viewer is owner or admin
  const isOwner = community.ownerId === viewerId;
  let isAdmin = false;
  if (!isOwner) {
    const membership = await db.membership.findUnique({
      where: { userId_communityId: { userId: viewerId!, communityId } },
      select: { role: true, status: true },
    });
    isAdmin = membership?.status === "APPROVED" && (membership.role === "OWNER" || membership.role === "ADMIN");
  }

  if (!isOwner && !isAdmin) {
    return errJson({ code: "FORBIDDEN", message: "Only owners and admins can send invitations", status: 403 });
  }

  // Verify target user exists
  const targetUser = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!targetUser) {
    return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
  }

  // Check if already a member
  const existingMembership = await db.membership.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { status: true },
  });

  if (existingMembership?.status === "APPROVED") {
    return errJson({ code: "CONFLICT", message: "User is already a member", status: 409 });
  }

  // Upsert invitation (handles re-inviting after decline)
  const invitation = await db.invitation.upsert({
    where: { communityId_invitedUserId: { communityId, invitedUserId: userId } },
    create: {
      communityId,
      invitedUserId: userId,
      invitedByUserId: viewerId!,
      status: "PENDING",
      message: message ?? null,
    },
    update: {
      status: "PENDING",
      invitedByUserId: viewerId!,
      message: message ?? null,
      declinedAt: null,
    },
    select: { id: true, status: true },
  });

  // Create notification for the invitee (avoid duplicates on re-invite)
  const existingNotification = await db.notification.findFirst({
    where: {
      userId,
      type: "COMMUNITY_INVITE",
      metadata: { path: ["invitationId"], equals: invitation.id },
    },
    select: { id: true },
  });

  if (!existingNotification) {
    await db.notification.create({
      data: {
        userId,
        type: "COMMUNITY_INVITE",
        title: `You've been invited to join ${community.name}`,
        message: message ?? null,
        metadata: {
          communityId,
          communityName: community.name,
          invitationId: invitation.id,
          invitedByUserId: viewerId,
        },
      },
    });
  }

  return okJson<SendOk>({ invitation: { id: invitation.id, status: invitation.status } });
}, { auth: "onboarded" });

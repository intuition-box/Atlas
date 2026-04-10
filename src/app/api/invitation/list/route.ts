import { HandleOwnerType } from "@prisma/client";
import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveHandleNamesForOwners } from "@/lib/handle-registry";

export const runtime = "nodejs";

const QuerySchema = z.object({
  communityId: z.string().trim().min(1),
  status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "REVOKED"]).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

type InvitationItem = {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  invitedUser: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
  invitedByUser: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
};

type InvitationListOk = {
  invitations: InvitationItem[];
  nextCursor: string | null;
};

export const GET = api(QuerySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { communityId, status, take, cursor } = json;

  // Verify viewer is owner/admin
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { ownerId: true },
  });

  if (!community) {
    return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

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
    return errJson({ code: "FORBIDDEN", message: "Only owners and admins can view invitations", status: 403 });
  }

  const rows = await db.invitation.findMany({
    where: {
      communityId,
      ...(status ? { status } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      message: true,
      createdAt: true,
      acceptedAt: true,
      declinedAt: true,
      invitedUserId: true,
      invitedByUserId: true,
      invitedUser: { select: { id: true, name: true, avatarUrl: true } },
      invitedByUser: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  const page = rows.slice(0, take);
  const nextCursor = rows.length > take ? rows[take]!.id : null;

  // Resolve handles
  const userIds = Array.from(new Set(page.flatMap((r) => [r.invitedUserId, r.invitedByUserId])));
  const handleByUserId = await resolveHandleNamesForOwners({
    ownerType: HandleOwnerType.USER,
    ownerIds: userIds,
  });

  const invitations: InvitationItem[] = page.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    declinedAt: r.declinedAt?.toISOString() ?? null,
    invitedUser: {
      id: r.invitedUser.id,
      handle: handleByUserId.get(r.invitedUserId) ?? null,
      name: r.invitedUser.name,
      avatarUrl: r.invitedUser.avatarUrl,
    },
    invitedByUser: {
      id: r.invitedByUser.id,
      handle: handleByUserId.get(r.invitedByUserId) ?? null,
      name: r.invitedByUser.name,
      avatarUrl: r.invitedByUser.avatarUrl,
    },
  }));

  return okJson<InvitationListOk>({ invitations, nextCursor });
}, { methods: ["GET"], auth: "onboarded" });

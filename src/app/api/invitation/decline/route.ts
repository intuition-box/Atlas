import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const BodySchema = z.object({
  invitationId: z.string().trim().min(1),
});

type DeclineOk = { declined: true };

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { invitationId } = json;

  const invitation = await db.invitation.findUnique({
    where: { id: invitationId },
    select: { id: true, invitedUserId: true, status: true },
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

  await db.invitation.update({
    where: { id: invitationId },
    data: { status: "DECLINED", declinedAt: new Date() },
  });

  return okJson<DeclineOk>({ declined: true });
}, { auth: "auth" });

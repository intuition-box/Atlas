import { Prisma } from "@prisma/client";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import {
  requirePermission,
  hasAtLeastRole,
  RolePermissionsSchema,
} from "@/lib/permissions";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  communityId: z.string().min(1),
  permissions: RolePermissionsSchema,
});

export const POST = api(schema, async (ctx) => {
  const { viewerId, json } = ctx;

  // Require the community.permissions permission (owners always pass)
  const membership = await requirePermission({
    userId: viewerId!,
    communityId: json.communityId,
    permission: "community.permissions",
  });

  // Non-owners cannot change ADMIN permissions — preserve the saved values.
  // This prevents the paradox of admins editing their own role's permissions.
  const isOwner = hasAtLeastRole(membership.role, "OWNER");
  let finalPermissions = json.permissions;

  if (!isOwner) {
    const community = await db.community.findUniqueOrThrow({
      where: { id: json.communityId },
      select: { permissions: true },
    });
    const saved = RolePermissionsSchema.safeParse(community.permissions);
    const savedAdmin = saved.success ? saved.data.ADMIN : [];
    finalPermissions = { ...json.permissions, ADMIN: savedAdmin };
  }

  const community = await db.community.update({
    where: { id: json.communityId },
    data: {
      permissions: finalPermissions as unknown as Prisma.InputJsonValue,
    },
    select: {
      permissions: true,
    },
  });

  return okJson({ permissions: community.permissions });
}, { auth: "onboarded" });

import { Prisma } from "@prisma/client";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { requireCommunityRole, RolePermissionsSchema } from "@/lib/permissions";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  communityId: z.string().min(1),
  permissions: RolePermissionsSchema,
});

export const POST = api(schema, async (ctx) => {
  const { viewerId, json } = ctx;

  // Only owners can configure role permissions
  await requireCommunityRole({
    userId: viewerId!,
    communityId: json.communityId,
    minRole: "OWNER",
  });

  const community = await db.community.update({
    where: { id: json.communityId },
    data: {
      permissions: json.permissions as unknown as Prisma.InputJsonValue,
    },
    select: {
      permissions: true,
    },
  });

  return okJson({ permissions: community.permissions });
}, { auth: "onboarded" });

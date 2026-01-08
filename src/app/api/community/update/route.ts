import { NextResponse } from "next/server";

import { db } from "@/lib/database";
import { requireCommunityRole, requireUser } from "@/lib/permissions";
import { CommunityUpdateSchema } from "@/lib/validation/community";

export const runtime = "nodejs";

async function handler(req: Request) {
  const { userId } = await requireUser();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = CommunityUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  await requireCommunityRole({
    userId,
    communityId: body.communityId,
    minRole: "ADMIN",
  });

  const community = await db.community.update({
    where: { id: body.communityId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
      ...(body.isPublicDirectory !== undefined
        ? { isPublicDirectory: body.isPublicDirectory }
        : {}),
      ...(body.applicationFormSchema !== undefined
        ? { applicationFormSchema: body.applicationFormSchema }
        : {}),
      ...(body.orbitConfig !== undefined ? { orbitConfig: body.orbitConfig } : {}),
      activityEvents: { create: { actorId: userId, type: "COMMUNITY_UPDATED" } },
    },
    select: {
      id: true,
      handle: true,
      name: true,
      description: true,
      avatarUrl: true,
      isPublicDirectory: true,
      applicationFormSchema: true,
      orbitConfig: true,
    },
  });

  return NextResponse.json({ ok: true, community });
}

export async function PATCH(req: Request) {
  return handler(req);
}

// Back-compat with any existing clients still POSTing
export async function POST(req: Request) {
  return handler(req);
}
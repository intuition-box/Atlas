import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/database";
import { requireCommunityRole, requireUser } from "@/lib/permissions";
import { CommunityUpdateSchema } from "@/lib/validation/community";

export const runtime = "nodejs";

type ApiError = {
  code: number;
  message: string;
  details?: unknown;
};

function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

function jsonFail(status: number, message: string, details?: unknown, init?: ResponseInit) {
  const error: ApiError = { code: status, message, ...(details !== undefined ? { details } : {}) };
  return NextResponse.json({ ok: false, error }, { status, ...init });
}

function toNullableJson(value: unknown | null | undefined): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

export async function PATCH(req: Request) {
  const { userId } = await requireUser();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonFail(400, "Invalid JSON body");
  }

  const parsed = CommunityUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return jsonFail(400, "Invalid request", parsed.error.flatten());
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
      ...(body.isPublicDirectory !== undefined ? { isPublicDirectory: body.isPublicDirectory } : {}),
      ...(body.applicationFormSchema !== undefined
        ? { applicationFormSchema: toNullableJson(body.applicationFormSchema) }
        : {}),
      ...(body.orbitConfig !== undefined ? { orbitConfig: toNullableJson(body.orbitConfig) } : {}),
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

  return jsonOk({ community });
}
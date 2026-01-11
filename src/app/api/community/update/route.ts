import { CommunityConfigType, HandleOwnerType, MembershipRole, MembershipStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { NextResponse, type NextRequest } from "next/server";

import type { ApiEnvelope, ApiError, ApiIssue } from "@/lib/api-shapes";
import { errEnvelope, okEnvelope } from "@/lib/api-shapes";
import { db } from "@/lib/database";
import { requireAuth } from "@/lib/guards";
import { requireCsrf } from "@/lib/security/csrf";
import { CommunityUpdateSchema } from "@/lib/validations";

export const runtime = "nodejs";

type UpdateCommunityOk = {
  community: {
    id: string;
    handle: string;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    isApplicationOpen: boolean;
    isPublicDirectory: boolean;
    applicationConfig: unknown | null;
    orbitConfig: unknown | null;
  };
};

const UpdateCommunitySchema = CommunityUpdateSchema.refine(
  (v) =>
    v.name !== undefined ||
    v.description !== undefined ||
    v.avatarUrl !== undefined ||
    v.isApplicationOpen !== undefined ||
    v.isPublicDirectory !== undefined ||
    v.applicationConfig !== undefined ||
    v.orbitConfig !== undefined,
  { message: "No updates provided", path: ["name"] },
);

type StatusErr = ApiError<string, number, unknown>;

function zodIssues(e: z.ZodError): ApiIssue[] {
  return e.issues.map((iss) => ({
    path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
    message: iss.message,
  }));
}

function jsonError<E extends StatusErr>(e: E): NextResponse<ApiEnvelope<never>> {
  const res = NextResponse.json(errEnvelope(e), { status: e.status });
  res.headers.set("cache-control", "no-store");
  return res;
}

function prismaJson(
  v: unknown | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  // JSON fields: omit when undefined; represent SQL NULL with DbNull.
  if (v === undefined) return undefined;
  if (v === null) return Prisma.DbNull;
  return v as Prisma.InputJsonValue;
}

function revisionDbJson(
  v: unknown | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  // For standalone revision rows, represent a cleared config as SQL NULL.
  if (v === null) return Prisma.DbNull;
  return v as Prisma.InputJsonValue;
}

export async function POST(req: NextRequest): Promise<NextResponse<ApiEnvelope<UpdateCommunityOk>>> {
  const { userId } = await requireAuth();

  const csrf = requireCsrf(req);
  if (!csrf.ok) return jsonError(csrf.error);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError({ code: "INVALID_REQUEST", message: "Invalid JSON", status: 400 });
  }

  const parsed = UpdateCommunitySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError({
      code: "INVALID_REQUEST",
      message: "Invalid request",
      status: 400,
      issues: zodIssues(parsed.error),
    });
  }

  const input = parsed.data;

  const data: Prisma.CommunityUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
  if (input.isApplicationOpen !== undefined) data.isApplicationOpen = input.isApplicationOpen;
  if (input.isPublicDirectory !== undefined) data.isPublicDirectory = input.isPublicDirectory;
  if (input.applicationConfig !== undefined) data.applicationConfig = prismaJson(input.applicationConfig);
  if (input.orbitConfig !== undefined) data.orbitConfig = prismaJson(input.orbitConfig);

  const txResult = await (async () => {
    try {
      return await db.$transaction(async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { userId_communityId: { userId, communityId: input.communityId } },
          select: { status: true, role: true },
        });

        if (!membership || membership.status !== MembershipStatus.APPROVED) {
          return { kind: "not_found" } as const;
        }

        if (membership.role !== MembershipRole.OWNER && membership.role !== MembershipRole.ADMIN) {
          return { kind: "forbidden" } as const;
        }

        const community = await tx.community.update({
          where: { id: input.communityId },
          data,
          select: {
            id: true,
            name: true,
            description: true,
            avatarUrl: true,
            isApplicationOpen: true,
            isPublicDirectory: true,
            applicationConfig: true,
            orbitConfig: true,
          },
        });

        if (input.applicationConfig !== undefined) {
          await tx.communityConfigRevision.create({
            data: {
              communityId: input.communityId,
              type: CommunityConfigType.APPLICATION,
              config: revisionDbJson(input.applicationConfig),
              memberId: userId,
              note: "updated",
            },
            select: { id: true },
          });
        }

        if (input.orbitConfig !== undefined) {
          await tx.communityConfigRevision.create({
            data: {
              communityId: input.communityId,
              type: CommunityConfigType.ORBIT,
              config: revisionDbJson(input.orbitConfig),
              memberId: userId,
              note: "updated",
            },
            select: { id: true },
          });
        }

        const owner = await tx.handleOwner.findUnique({
          where: {
            ownerType_ownerId: {
              ownerType: HandleOwnerType.COMMUNITY,
              ownerId: community.id,
            },
          },
          select: { handle: { select: { name: true } } },
        });

        if (!owner) {
          // Community exists, but handle mapping is missing.
          return { kind: "not_found" } as const;
        }

        return { kind: "ok", community, handleName: owner.handle.name } as const;
      });
    } catch (e) {
      // Community was deleted between auth and update.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return { kind: "not_found" } as const;
      }
      throw e;
    }
  })();

  if (txResult.kind === "not_found") {
    return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  if (txResult.kind === "forbidden") {
    return jsonError({ code: "FORBIDDEN", message: "Insufficient permissions", status: 403 });
  }

  const updated = txResult.community;

  const body = okEnvelope<UpdateCommunityOk>({
    community: {
      id: updated.id,
      handle: txResult.handleName,
      name: updated.name,
      description: updated.description,
      avatarUrl: updated.avatarUrl,
      isApplicationOpen: updated.isApplicationOpen,
      isPublicDirectory: updated.isPublicDirectory,
      applicationConfig: (updated.applicationConfig as unknown) ?? null,
      orbitConfig: (updated.orbitConfig as unknown) ?? null,
    },
  });
  const res = NextResponse.json(body, { status: 200 });
  res.headers.set("cache-control", "no-store");
  return res;
}
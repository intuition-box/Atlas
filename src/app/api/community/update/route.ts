import {
  CommunityConfigType,
  HandleOwnerType,
  MembershipRole,
  MembershipStatus,
  Prisma,
} from "@prisma/client";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveHandleNameForOwner } from "@/lib/handle-registry";
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
    isMembershipOpen: boolean;
    isPublicDirectory: boolean;
    membershipConfig: unknown | null;
    orbitConfig: unknown | null;
  };
};

const UpdateSchema = CommunityUpdateSchema.refine(
  (v) =>
    v.name !== undefined ||
    v.description !== undefined ||
    v.avatarUrl !== undefined ||
    v.isMembershipOpen !== undefined ||
    v.isPublicDirectory !== undefined ||
    v.membershipConfig !== undefined ||
    v.orbitConfig !== undefined,
  { message: "No updates provided", path: ["name"] },
);

function prismaJson(
  v: unknown | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  // JSON fields: omit when undefined; represent SQL NULL with DbNull.
  if (v === undefined) return undefined;
  if (v === null) return Prisma.DbNull;
  return v as Prisma.InputJsonValue;
}

function revisionDbJson(v: unknown | null): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  // For standalone revision rows, represent a cleared config as SQL NULL.
  if (v === null) return Prisma.DbNull;
  return v as Prisma.InputJsonValue;
}

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
    const parsed = await UpdateSchema.safeParseAsync(raw);

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

    const input = parsed.data;
    const now = new Date();

    const data: Prisma.CommunityUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.isMembershipOpen !== undefined) data.isMembershipOpen = input.isMembershipOpen;
    if (input.isPublicDirectory !== undefined) data.isPublicDirectory = input.isPublicDirectory;
    if (input.membershipConfig !== undefined) data.membershipConfig = prismaJson(input.membershipConfig);
    if (input.orbitConfig !== undefined) data.orbitConfig = prismaJson(input.orbitConfig);

    const txResult = await db.$transaction(async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { userId_communityId: { userId, communityId: input.communityId } },
        select: { status: true, role: true },
      });

      if (!membership || membership.status !== MembershipStatus.APPROVED) {
        return { kind: "not_found" } as const;
      }

      if (
        membership.role !== MembershipRole.OWNER &&
        membership.role !== MembershipRole.ADMIN &&
        membership.role !== MembershipRole.MODERATOR
      ) {
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
          isMembershipOpen: true,
          isPublicDirectory: true,
          membershipConfig: true,
          orbitConfig: true,
        },
      });

      // Config revision history (only when those fields are provided in the payload)
      if (input.membershipConfig !== undefined) {
        await tx.communityConfigRevision.create({
          data: {
            communityId: input.communityId,
            type: CommunityConfigType.MEMBERSHIP,
            config: revisionDbJson(input.membershipConfig),
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

      const handleName = await resolveHandleNameForOwner(
        { ownerType: HandleOwnerType.COMMUNITY, ownerId: community.id },
        tx,
      );

      if (!handleName) {
        return { kind: "not_found" } as const;
      }

      return { kind: "ok", community, handleName } as const;
    });

    if (txResult.kind === "not_found") {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    if (txResult.kind === "forbidden") {
      return errJson({ code: "FORBIDDEN", message: "Insufficient permissions", status: 403 });
    }

    const updated = txResult.community;

    return okJson<UpdateCommunityOk>({
      community: {
        id: updated.id,
        handle: txResult.handleName,
        name: updated.name,
        description: updated.description,
        avatarUrl: updated.avatarUrl,
        isMembershipOpen: updated.isMembershipOpen,
        isPublicDirectory: updated.isPublicDirectory,
        membershipConfig: (updated.membershipConfig as unknown) ?? null,
        orbitConfig: (updated.orbitConfig as unknown) ?? null,
      },
    });
  } catch (e) {
    // Community was deleted between read and update.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}
import {
  CommunityConfigType,
  HandleOwnerType,
  HandleStatus,
  MembershipRole,
  MembershipStatus,
  Prisma,
} from "@prisma/client";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import { checkHandleForNewOwner } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";
import { CommunityCreateSchema } from "@/lib/validations";

export const runtime = "nodejs";

type CreateCommunityOk = {
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

type CreatedCommunity = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  isMembershipOpen: boolean;
  isPublicDirectory: boolean;
  membershipConfig: unknown;
  orbitConfig: unknown;
  handleName: string;
};

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
  // For revision rows (standalone create), represent a cleared config as SQL NULL.
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
    if (raw === null) {
      return errJson({ code: "INVALID_REQUEST", message: "Invalid JSON", status: 400 });
    }

    const parsed = await CommunityCreateSchema.safeParseAsync(raw);
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

    // Validate handle lifecycle + normalize.
    const handleRes = await checkHandleForNewOwner({ handle: input.handle });
    if (!handleRes.ok) return errJson(handleRes.error);

    const handleName = handleRes.value.handle;

    // Create community + handle + owner membership atomically.
    // If handle-name uniqueness collides, re-check to return the correct lifecycle error.
    let created: CreatedCommunity;

    try {
      created = await db.$transaction(async (tx) => {
        const community = await tx.community.create({
          data: {
            ownerId: userId,
            name: input.name,
            description: input.description ?? null,
            avatarUrl: input.avatarUrl ?? null,
            isMembershipOpen: input.isMembershipOpen ?? true,
            isPublicDirectory: input.isPublicDirectory ?? false,

            membershipConfig: prismaJson(input.membershipConfig),
            orbitConfig: prismaJson(input.orbitConfig),

            memberships: {
              create: {
                userId,
                role: MembershipRole.OWNER,
                status: MembershipStatus.APPROVED,
                approvedAt: now,
                lastActiveAt: now,
              },
            },
          },
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

        // Create or activate the Handle row, then create the canonical owner mapping.
        // We validated lifecycle before entering the tx, but we re-check here to be race-safe.
        let handleId: string;

        const existing = await tx.handle.findUnique({
          where: { name: handleName },
          select: { id: true, status: true },
        });

        if (!existing) {
          const createdHandle = await tx.handle.create({
            data: {
              name: handleName,
              status: HandleStatus.ACTIVE,
            },
            select: { id: true },
          });
          handleId = createdHandle.id;
        } else {
          if (existing.status === HandleStatus.ACTIVE) {
            // Another transaction claimed it after our pre-check.
            throw new Error("HANDLE_TAKEN");
          }
          if (existing.status === HandleStatus.RETIRED) {
            throw new Error("HANDLE_RETIRED");
          }

          // RELEASED and claimable: activate and clear release metadata.
          await tx.handle.update({
            where: { id: existing.id },
            data: {
              status: HandleStatus.ACTIVE,
              reclaimUntil: null,
              availableAt: null,
              lastOwnerType: null,
              lastOwnerId: null,
            },
            select: { id: true },
          });

          handleId = existing.id;
        }

        await tx.handleOwner.create({
          data: {
            handleId,
            ownerType: HandleOwnerType.COMMUNITY,
            ownerId: community.id,
          },
          select: { handleId: true },
        });

        if (input.membershipConfig !== undefined) {
          await tx.communityConfigRevision.create({
            data: {
              communityId: community.id,
              type: CommunityConfigType.MEMBERSHIP,
              config: revisionDbJson(input.membershipConfig),
              memberId: userId,
              note: "initial",
            },
            select: { id: true },
          });
        }

        if (input.orbitConfig !== undefined) {
          await tx.communityConfigRevision.create({
            data: {
              communityId: community.id,
              type: CommunityConfigType.ORBIT,
              config: revisionDbJson(input.orbitConfig),
              memberId: userId,
              note: "initial",
            },
            select: { id: true },
          });
        }

        return { ...community, handleName };
      });
    } catch (e) {
      if (e instanceof Error && (e.message === "HANDLE_TAKEN" || e.message === "HANDLE_RETIRED")) {
        // Surface the lifecycle error when possible.
        const again = await checkHandleForNewOwner({ handle: input.handle });
        if (!again.ok) return errJson(again.error);

        return errJson({ code: "HANDLE_TAKEN", message: "Handle is not available", status: 409 });
      }

      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await checkHandleForNewOwner({ handle: input.handle });
        if (!again.ok) return errJson(again.error);

        return errJson({ code: "HANDLE_TAKEN", message: "Handle is not available", status: 409 });
      }

      throw e;
    }

    return okJson<CreateCommunityOk>({
      community: {
        id: created.id,
        handle: created.handleName,
        name: created.name,
        description: created.description,
        avatarUrl: created.avatarUrl,
        isMembershipOpen: created.isMembershipOpen,
        isPublicDirectory: created.isPublicDirectory,
        membershipConfig: (created.membershipConfig as unknown) ?? null,
        orbitConfig: (created.orbitConfig as unknown) ?? null,
      },
    });
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

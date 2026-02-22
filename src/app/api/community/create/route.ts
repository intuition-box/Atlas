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
import type { ApiError, ApiIssue } from "@/lib/api/shapes";
import { db } from "@/lib/db/client";
import { checkHandlePubliclyAvailable, claimHandle } from "@/lib/handle-registry";
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

function isApiIssue(x: unknown): x is ApiIssue {
  if (typeof x !== "object" || x === null) return false;
  const v = x as Record<string, unknown>;
  if (!Array.isArray(v.path)) return false;
  if (typeof v.message !== "string") return false;
  // Path segments must be string | number (no symbols)
  for (const seg of v.path) {
    if (typeof seg !== "string" && typeof seg !== "number") return false;
  }
  return true;
}

function isApiErrorShape(e: unknown): e is ApiError<string, number, unknown> {
  if (typeof e !== "object" || e === null) return false;
  const v = e as Record<string, unknown>;

  if (typeof v.code !== "string") return false;
  if (typeof v.message !== "string") return false;
  if (typeof v.status !== "number") return false;

  if (v.issues !== undefined) {
    if (!Array.isArray(v.issues)) return false;
    for (const iss of v.issues) {
      if (!isApiIssue(iss)) return false;
    }
  }

  return true;
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

    // Validate handle availability + normalize.
    const handleRes = await checkHandlePubliclyAvailable({ handle: input.handle });
    if (!handleRes.ok) return errJson(handleRes.error);

    const handleName = handleRes.value.handle;

    // Create community + handle + owner membership atomically.
    // If handle-name uniqueness collides, re-check to return the correct lifecycle error.
    let created: CreateCommunityOk;

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

            discordUrl: input.discordUrl ?? null,
            xUrl: input.xUrl ?? null,
            telegramUrl: input.telegramUrl ?? null,
            githubUrl: input.githubUrl ?? null,
            websiteUrl: input.websiteUrl ?? null,

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

        // Claim the handle for this community (race-safe).
        const claimed = await claimHandle(tx, {
          ownerType: HandleOwnerType.COMMUNITY,
          ownerId: community.id,
          handle: handleName,
        });

        if (!claimed.ok) {
          // Bubble up the canonical handle-registry problem.
          throw claimed.error;
        }

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

        return {
          community: {
            ...community,
            handle: claimed.value.handle,
            membershipConfig: (community.membershipConfig as unknown) ?? null,
            orbitConfig: (community.orbitConfig as unknown) ?? null,
          },
        };
      });
    } catch (e) {
      if (isApiErrorShape(e)) {
        return errJson(e);
      }

      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // Unique constraint hit (either `Handle.name` or `Handle.key`). Re-check lifecycle for a canonical problem.
        const again = await checkHandlePubliclyAvailable({ handle: input.handle });
        if (!again.ok) return errJson(again.error);

        // Should be rare: if we still can't explain it, fall back to a safe generic.
        return errJson({ code: "HANDLE_TAKEN", message: "Handle is not available", status: 409 });
      }

      throw e;
    }

    return okJson<CreateCommunityOk>(created);
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

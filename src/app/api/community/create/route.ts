import {
  CommunityConfigType,
  HandleOwnerType,
  HandleStatus,
  MembershipRole,
  MembershipStatus,
  Prisma,
} from "@prisma/client";
import { z } from "zod";

import { CommunityCreateSchema } from "@/lib/validations";

import { NextResponse, type NextRequest } from "next/server";

import type { ApiEnvelope, ApiError, ApiIssue } from "@/lib/api-shapes";
import { errEnvelope, okEnvelope } from "@/lib/api-shapes";
import { db } from "@/lib/database";
import { requireAuth } from "@/lib/guards";
import { checkHandleForNewOwner } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type CreateCommunityOk = {
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

type CreatedCommunity = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  isApplicationOpen: boolean;
  isPublicDirectory: boolean;
  applicationConfig: unknown;
  orbitConfig: unknown;
  handleName: string;
};

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
  // For revision rows (standalone create), represent a cleared config as SQL NULL.
  if (v === null) return Prisma.DbNull;
  return v as Prisma.InputJsonValue;
}

export async function POST(req: NextRequest): Promise<NextResponse<ApiEnvelope<CreateCommunityOk>>> {
  const { userId } = await requireAuth();

  const csrf = requireCsrf(req);
  if (!csrf.ok) return jsonError(csrf.error);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError({ code: "INVALID_REQUEST", message: "Invalid JSON", status: 400 });
  }

  const parsed = CommunityCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError({
      code: "INVALID_REQUEST",
      message: "Invalid request",
      status: 400,
      issues: zodIssues(parsed.error),
    });
  }

  const input = parsed.data;
  const now = new Date();

  // Validate handle lifecycle + normalize.
  const handleRes = await checkHandleForNewOwner({ handle: input.handle });
  if (!handleRes.ok) return jsonError(handleRes.error);

  const handleName = handleRes.value.handle;

  // Create community + handle + owner membership atomically.
  // If handle-name uniqueness collides, re-check to return the correct lifecycle error.
  let created!: CreatedCommunity;
  try {
    created = await db.$transaction(async (tx) => {
      const community = await tx.community.create({
        data: {
          ownerId: userId,
          name: input.name,
          description: input.description ?? null,
          avatarUrl: input.avatarUrl ?? null,
          isApplicationOpen: input.isApplicationOpen ?? true,
          isPublicDirectory: input.isPublicDirectory ?? false,

          applicationConfig: prismaJson(input.applicationConfig),
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
          isApplicationOpen: true,
          isPublicDirectory: true,
          applicationConfig: true,
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
        if (existing.status === "ACTIVE") {
          // Another transaction claimed it after our pre-check.
          throw new Error("HANDLE_TAKEN");
        }
        if (existing.status === "RETIRED") {
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

      if (input.applicationConfig !== undefined) {
        await tx.communityConfigRevision.create({
          data: {
            communityId: community.id,
            type: CommunityConfigType.APPLICATION,
            config: revisionDbJson(input.applicationConfig),
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
      const again = await checkHandleForNewOwner({ handle: input.handle });
      if (!again.ok) return jsonError(again.error);

      return jsonError({ code: "HANDLE_TAKEN", message: "Handle is not available", status: 409 });
    }

    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = e.meta?.target;
      const targetList = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];

      const lower = targetList.map((t) => String(t).toLowerCase());
      const isHandleNameUnique = lower.some((t) => t.includes("handle") && t.includes("name"));
      const isHandleOwnerUnique = lower.some((t) => t.includes("handleowner"));

      if (isHandleNameUnique || isHandleOwnerUnique) {
        // Handle-name collision: return the true lifecycle error if possible.
        const again = await checkHandleForNewOwner({ handle: input.handle });
        if (!again.ok) return jsonError(again.error);

        return jsonError({ code: "HANDLE_TAKEN", message: "Handle is not available", status: 409 });
      }
    }

    throw e;
  }

  const body = okEnvelope<CreateCommunityOk>({
    community: {
      id: created.id,
      handle: created.handleName,
      name: created.name,
      description: created.description,
      avatarUrl: created.avatarUrl,
      isApplicationOpen: created.isApplicationOpen,
      isPublicDirectory: created.isPublicDirectory,
      applicationConfig: (created.applicationConfig as unknown) ?? null,
      orbitConfig: (created.orbitConfig as unknown) ?? null,
    },
  });

  const res = NextResponse.json(body, { status: 200 });
  res.headers.set("cache-control", "no-store");
  return res;
}

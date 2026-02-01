import type { NextRequest } from "next/server";
import { z } from "zod";

import { HandleStatus, MembershipRole, MembershipStatus } from "@prisma/client";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveCommunityIdFromHandle, resolveUserIdFromHandle } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";
import { recomputeMemberScores } from "@/lib/scoring";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    // Prefer ids. Handles are supported for user-facing flows.
    applicationId: z.string().trim().min(1).optional(),

    communityId: z.string().trim().min(1).optional(),
    communityHandle: z.string().trim().min(1).optional(),

    userId: z.string().trim().min(1).optional(),
    userHandle: z.string().trim().min(1).optional(),

    decision: z.enum(["APPROVE", "REJECT"] as const),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.applicationId) return;

    const hasCommunity = Boolean(v.communityId || v.communityHandle);
    const hasUser = Boolean(v.userId || v.userHandle);

    if (!hasCommunity || !hasUser) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["applicationId"],
        message: "applicationId or (community + user) is required",
      });
    }
  });

type ReviewOk = {
  membership: {
    id: string;
    status: MembershipStatus;
  };
  alreadyReviewed: boolean;
};


const REVIEW_ROLES: MembershipRole[] = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.MODERATOR,
];

const QuerySchema = z
  .object({
    communityId: z.string().trim().min(1).optional(),
    communityHandle: z.string().trim().min(1).optional(),
    q: z.string().trim().max(80).optional(),
    limit: z
      .string()
      .trim()
      .optional()
      .transform((v) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : undefined
      })
      .pipe(z.number().int().min(1).max(200).optional()),
  })
  .superRefine((v, ctx) => {
    if (v.communityId || v.communityHandle) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["communityId"],
      message: "communityId or communityHandle is required",
    })
  })

type ReviewListOk = {
  applications: Array<{
    id: string
    createdAt: string
    answers: unknown
    user: {
      id: string
      handle: string | null
      name: string | null
      image: string | null
      createdAt: string
    }
  }>
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id

    if (!userId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 })
    }

    const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))

    if (!parsed.success) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Invalid request",
        status: 400,
        issues: parsed.error.issues.map((iss) => ({
          path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
          message: iss.message,
        })),
      })
    }

    let communityId = parsed.data.communityId ?? null
    if (!communityId && parsed.data.communityHandle) {
      const resolved = await resolveCommunityIdFromHandle(parsed.data.communityHandle)
      if (!resolved.ok) return errJson(resolved.error)
      communityId = resolved.value
    }

    if (!communityId) {
      return errJson({ code: "INVALID_REQUEST", message: "Invalid request", status: 400 })
    }

    const reviewer = await db.membership.findFirst({
      where: {
        communityId,
        userId,
        status: MembershipStatus.APPROVED,
      },
      select: { id: true, role: true },
    })

    if (!reviewer || !REVIEW_ROLES.includes(reviewer.role)) {
      return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 })
    }

    const q = String(parsed.data.q || "").trim().toLowerCase()
    const take = parsed.data.limit ?? 100

    const apps = await db.application.findMany({
      where: {
        communityId,
        status: MembershipStatus.PENDING,
        ...(q
          ? {
              user: {
                OR: [{ name: { contains: q, mode: "insensitive" } }],
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        createdAt: true,
        answers: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            createdAt: true,
          },
        },
      },
    })

    const userIds = Array.from(new Set(apps.map((a) => a.user.id)))

    const owners = await db.handleOwner.findMany({
      where: {
        ownerType: "USER",
        ownerId: { in: userIds },
        handle: {
          status: HandleStatus.ACTIVE,
        },
      },
      select: {
        ownerId: true,
        handle: {
          select: {
            name: true,
          },
        },
      },
    })

    const handleByUserId = new Map<string, string>()
    for (const o of owners) {
      const h = String(o.handle?.name || "").trim()
      if (h) handleByUserId.set(String(o.ownerId), h)
    }

    return okJson<ReviewListOk>({
      applications: apps.map((a) => ({
        id: a.id,
        createdAt: a.createdAt.toISOString(),
        answers: a.answers,
        user: {
          id: a.user.id,
          handle: handleByUserId.get(a.user.id) ?? null,
          name: a.user.name ?? null,
          image: a.user.image ?? null,
          createdAt: a.user.createdAt.toISOString(),
        },
      })),
    })
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    })
  }
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

    const body = await req.json().catch(() => null);
    const parsed = await BodySchema.safeParseAsync(body);

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

    const { decision, note } = parsed.data;

    let app:
      | {
          id: string;
          communityId: string;
          userId: string;
          status: MembershipStatus;
        }
      | null = null;

    if (parsed.data.applicationId) {
      app = await db.application.findUnique({
        where: { id: parsed.data.applicationId },
        select: { id: true, communityId: true, userId: true, status: true },
      });
    } else {
      let communityId = parsed.data.communityId ?? null;
      if (!communityId && parsed.data.communityHandle) {
        const resolved = await resolveCommunityIdFromHandle(parsed.data.communityHandle);
        if (!resolved.ok) return errJson(resolved.error);
        communityId = resolved.value;
      }

      let targetUserId = parsed.data.userId ?? null;
      if (!targetUserId && parsed.data.userHandle) {
        const resolved = await resolveUserIdFromHandle(parsed.data.userHandle);
        if (!resolved.ok) return errJson(resolved.error);
        targetUserId = resolved.value;
      }

      if (!communityId || !targetUserId) {
        return errJson({ code: "INVALID_REQUEST", message: "Invalid request", status: 400 });
      }

      app = await db.application.findFirst({
        where: { communityId, userId: targetUserId },
        select: { id: true, communityId: true, userId: true, status: true },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!app) {
      return errJson({ code: "NOT_FOUND", message: "Membership request not found", status: 404 });
    }

    // Reviewer must be an approved member with review privileges.
    const reviewer = await db.membership.findFirst({
      where: {
        communityId: app.communityId,
        userId,
        status: MembershipStatus.APPROVED,
      },
      select: { id: true, role: true },
    });

    if (!reviewer || !REVIEW_ROLES.includes(reviewer.role)) {
      return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    // Idempotency: if already reviewed, return ok only when the decision matches.
    if (app.status !== MembershipStatus.PENDING) {
      const desired =
        decision === "APPROVE" ? MembershipStatus.APPROVED : MembershipStatus.REJECTED;

      if (app.status === desired) {
        return okJson<ReviewOk>({
          membership: { id: app.id, status: app.status },
          alreadyReviewed: true,
        });
      }

      return errJson({
        code: "CONFLICT",
        message: "Application is already reviewed",
        status: 409,
      });
    }

    const now = new Date();
    const nextStatus: MembershipStatus =
      decision === "APPROVE" ? MembershipStatus.APPROVED : MembershipStatus.REJECTED;

    const updated = await db.$transaction(async (tx) => {
      const updatedApp = await tx.application.update({
        where: { id: app.id },
        data: {
          status: nextStatus,
          reviewedAt: now,
          reviewerId: userId,
          reviewNote: note ?? null,
        },
        select: { id: true, status: true },
      });

      // Keep membership aligned with the decision.
      if (decision === "APPROVE") {
        await tx.membership.upsert({
          where: {
            userId_communityId: {
              userId: app.userId,
              communityId: app.communityId,
            },
          },
          create: {
            userId: app.userId,
            communityId: app.communityId,
            role: MembershipRole.MEMBER,
            status: MembershipStatus.APPROVED,
            approvedAt: now,
            lastActiveAt: now,
          },
          update: {
            status: MembershipStatus.APPROVED,
            approvedAt: now,
          },
          select: { id: true },
        });
      } else {
        // Reject: do not create a membership row; if one exists, mark it rejected.
        await tx.membership.updateMany({
          where: {
            userId: app.userId,
            communityId: app.communityId,
          },
          data: {
            status: MembershipStatus.REJECTED,
          },
        });
      }

      // Keep reviewer warm.
      await tx.membership.updateMany({
        where: { id: reviewer.id },
        data: { lastActiveAt: now },
      });

      return updatedApp;
    });

    if (decision === "APPROVE") {
      try {
        await recomputeMemberScores({ communityId: app.communityId, userId: app.userId });
      } catch {
        // Ignore scoring failures; approval is already committed.
      }
    }

    return okJson<ReviewOk>({
      membership: { id: updated.id, status: updated.status },
      alreadyReviewed: false,
    });
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}

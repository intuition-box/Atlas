import type { NextRequest } from "next/server";
import { HandleOwnerType, MembershipStatus } from "@prisma/client";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import {
  resolveCommunityIdFromHandle,
  resolveHandleNameForOwner,
} from "@/lib/handle-registry";
import { CommunityGetSchema } from "@/lib/validations";

export const runtime = "nodejs";

type CommunityGetOk = {
  community: {
    id: string;
    handle: string;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    isMembershipOpen: boolean;
    membershipConfig: unknown | null;
    orbitConfig: unknown | null;
  };
};

export async function GET(req: NextRequest) {
  try {
    const parsed = CommunityGetSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );

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

    let communityId = input.communityId ?? null;

    if (!communityId && input.handle) {
      const resolved = await resolveCommunityIdFromHandle(input.handle);
      if (!resolved.ok) return errJson(resolved.error);
      communityId = resolved.value;
    }

    if (!communityId) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    const row = await db.community.findUnique({
      where: { id: communityId },
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

    if (!row) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    // Privacy: if not in public directory, only APPROVED members may fetch.
    if (!row.isPublicDirectory) {
      const session = await auth();
      const userId = session?.user?.id ?? null;

      if (!userId) {
        // Treat unauthenticated as not found to avoid leaking private communities.
        return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
      }

      const membership = await db.membership.findUnique({
        where: { userId_communityId: { userId, communityId } },
        select: { status: true },
      });

      if (!membership || membership.status !== MembershipStatus.APPROVED) {
        return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
      }
    }

    const handleName = await resolveHandleNameForOwner(
      { ownerType: HandleOwnerType.COMMUNITY, ownerId: row.id },
      db,
    );

    if (!handleName) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    return okJson<CommunityGetOk>({
      community: {
        id: row.id,
        handle: handleName,
        name: row.name,
        description: row.description,
        avatarUrl: row.avatarUrl,
        isMembershipOpen: row.isMembershipOpen,
        membershipConfig: (row.membershipConfig as unknown) ?? null,
        orbitConfig: (row.orbitConfig as unknown) ?? null,
      },
    });
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

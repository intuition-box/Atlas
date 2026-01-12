import { HandleOwnerType, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import { resolveHandleNameForOwner, resolveUserIdFromHandle } from "@/lib/handle-registry";

export const runtime = "nodejs";

type GetUserOk = {
  user: {
    id: string;
    handle: string | null;
    name: string | null;
    image: string | null;
  };
  isSelf: boolean;
};

const QuerySchema = z.object({
  userId: z.string().min(1).optional(),
  handle: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const actorId = session?.user?.id ?? null;

    const sp = req.nextUrl.searchParams;
    const parsed = QuerySchema.safeParse({
      userId: sp.get("userId") ?? undefined,
      handle: sp.get("handle") ?? undefined,
    });

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
    const handleInput = input.handle; // raw user input

    // Default to self only when no identifier is provided.
    if (!input.userId && !handleInput) {
      if (!actorId) {
        return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
      }
    }

    // Resolve target user id (prefer explicit ids; support handle for public lookup).
    let targetUserId: string | null = input.userId ?? null;

    if (!targetUserId && handleInput) {
      const resolved = await resolveUserIdFromHandle(handleInput);
      if (!resolved.ok) return errJson(resolved.error);
      targetUserId = resolved.value;
    }

    // Default to self when no identifier is provided.
    if (!targetUserId) targetUserId = actorId;

    if (!targetUserId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const user = await db.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        image: true,
      },
    });

    if (!user) {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }

    const handleName = await resolveHandleNameForOwner({ ownerType: HandleOwnerType.USER, ownerId: user.id });

    return okJson<GetUserOk>({
      user: {
        id: user.id,
        handle: handleName,
        name: user.name,
        image: user.image,
      },
      isSelf: actorId === user.id,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }

    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

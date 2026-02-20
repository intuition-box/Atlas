import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { deleteR2Object, extractR2Key } from "@/lib/r2";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const csrf = requireCsrf(req);
    if (!csrf.ok) {
      return errJson({ code: csrf.error.code, message: csrf.error.message, status: csrf.error.status });
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    if (!user) {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }

    // Delete the R2 object if the current avatar is hosted on R2.
    if (user.avatarUrl) {
      const key = extractR2Key(user.avatarUrl);
      if (key) {
        try {
          await deleteR2Object(key);
        } catch {
          // Best-effort: don't block the DB update if R2 delete fails.
          // The object will be orphaned but the user can proceed.
        }
      }
    }

    // Clear both avatar fields in the DB.
    await db.user.update({
      where: { id: userId },
      data: { avatarUrl: null, image: null },
      select: { id: true },
    });

    return okJson({ deleted: true });
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}

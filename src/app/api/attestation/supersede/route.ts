import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

const BodySchema = z.object({
  attestationId: z.string().trim().min(1),
  // New values to apply to the replacement attestation.
  // Semantics:
  // - undefined: keep existing
  // - null: clear
  // - value: set
  confidence: z.union([z.number().finite().min(0).max(1), z.null()]).optional(),
});

type SupersedeOk = {
  attestation: {
    id: string;
    supersedesId: string;
  };
};

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

    const { attestationId, confidence } = parsed.data;

    if (confidence === undefined) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Nothing to change",
        status: 400,
      });
    }

    const existing = await db.attestation.findUnique({
      where: { id: attestationId },
      select: {
        id: true,
        fromUserId: true,
        toUserId: true,
        type: true,
        confidence: true,
        revokedAt: true,
        supersededById: true,
      },
    });

    if (!existing) {
      return errJson({ code: "NOT_FOUND", message: "Attestation not found", status: 404 });
    }

    if (existing.revokedAt) {
      return errJson({ code: "CONFLICT", message: "Attestation is revoked", status: 409 });
    }

    if (existing.supersededById) {
      return errJson({
        code: "CONFLICT",
        message: "Attestation is already superseded",
        status: 409,
      });
    }

    // Only the author can supersede their own attestation.
    if (existing.fromUserId !== userId) {
      return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    const nextConfidence = confidence === null ? null : confidence;

    // If nothing changes, avoid creating a no-op replacement.
    if (nextConfidence === (existing.confidence ?? null)) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Nothing to change",
        status: 400,
      });
    }

    const created = await db.$transaction(async (tx) => {
      const replacement = await tx.attestation.create({
        data: {
          fromUserId: existing.fromUserId,
          toUserId: existing.toUserId,
          type: existing.type,
          confidence: nextConfidence,
        },
        select: { id: true },
      });

      await tx.attestation.update({
        where: { id: existing.id },
        data: { supersededById: replacement.id },
        select: { id: true },
      });

      return replacement;
    });

    return okJson<SupersedeOk>({
      attestation: { id: created.id, supersedesId: existing.id },
    });
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}

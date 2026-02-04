import { z } from "zod";

import { db } from "@/lib/db/client";
import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { resolveUserIdFromHandle } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";
import { ATTESTATION_TYPES, type AttestationType } from "@/config/attestations";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const attestationTypeValues = Object.keys(ATTESTATION_TYPES) as [AttestationType, ...AttestationType[]];

const BodySchema = z.object({
  // Always use userId; handle is for UI convenience only
  toUserId: z.string().trim().min(1),

  // Attestation type from config
  type: z.enum(attestationTypeValues),
});

type CreateAttestationOk = {
  attestation: {
    id: string;
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

    const { toUserId, type } = parsed.data;

    // Can't attest yourself
    if (toUserId === userId) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "You can't attest yourself",
        status: 400,
      });
    }

    // Verify target user exists
    const targetUser = await db.user.findUnique({
      where: { id: toUserId },
      select: { id: true },
    });

    if (!targetUser) {
      return errJson({
        code: "NOT_FOUND",
        message: "User not found",
        status: 404,
      });
    }

    // Create attestation (no constraints - user can attest multiple times)
    const attestation = await db.attestation.create({
      data: {
        fromUserId: userId,
        toUserId,
        type,
      },
      select: { id: true },
    });

    return okJson<CreateAttestationOk>({ attestation: { id: attestation.id } });
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}

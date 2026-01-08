import { NextResponse } from "next/server";

import { db } from "@/lib/database";
import { AttestationListSchema } from "@/lib/validation/attestation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const raw = {
    communityId: sp.get("communityId") || undefined,
    userId: sp.get("userId") || undefined, // toUserId
    fromUserId: sp.get("fromUserId") || undefined,
    take: sp.get("take") ? Number(sp.get("take")) : undefined,
  };

  const parsed = AttestationListSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const attestations = await db.attestation.findMany({
    where: {
      ...(body.communityId ? { communityId: body.communityId } : {}),
      ...(body.userId ? { toUserId: body.userId } : {}),
      ...(body.fromUserId ? { fromUserId: body.fromUserId } : {}),
    },
    take: body.take ?? 50,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      communityId: true,
      type: true,
      note: true,
      confidence: true,
      createdAt: true,
      fromUser: {
        select: { id: true, name: true, avatarUrl: true, headline: true },
      },
      toUser: { select: { id: true, name: true, avatarUrl: true, headline: true } },
    },
  });

  return NextResponse.json({ ok: true, attestations });
}
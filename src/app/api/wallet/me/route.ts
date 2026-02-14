import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth/session";
import { okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

/* ────────────────────────────
   Types
──────────────────────────── */

type WalletRow = {
  address: string;
  linkedAt: string;
};

type WalletMeOk = {
  wallets: WalletRow[];
};

/* ────────────────────────────
   Handler
──────────────────────────── */

/**
 * Get all linked wallets for the authenticated user.
 *
 * Always returns 200 with `{ wallets }`.
 * Returns empty array if no wallets linked or user is not authenticated.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return okJson<WalletMeOk>({ wallets: [] });
  }

  const rows = await db.wallet.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { address: true, createdAt: true },
  });

  const wallets: WalletRow[] = rows.map((r) => ({
    address: r.address,
    linkedAt: r.createdAt.toISOString(),
  }));

  return okJson<WalletMeOk>({ wallets });
}

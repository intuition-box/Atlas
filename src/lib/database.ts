import "server-only";

import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

const isDev = process.env.NODE_ENV !== "production";

// Neon serverless driver uses WebSockets in Node.js.
neonConfig.webSocketConstructor = ws;

// Turbopack-safe global singleton
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function makeClient() {
  // Runtime uses the pooled Neon connection string.
  // For migrations, prefer the unpooled URL via prisma.config.ts (e.g. DATABASE_URL_UNPOOLED).
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set DATABASE_URL to your Neon pooled (pooler) connection string."
    );
  }

  const adapter = new PrismaNeon({ connectionString: url });

  return new PrismaClient({
    adapter,
    log: isDev ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.__prisma ?? makeClient();

if (isDev) {
  globalForPrisma.__prisma = db;
}

/** Transaction client type alias for convenience in services/policies */
export type Tx = Prisma.TransactionClient;

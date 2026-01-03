import "server-only";

import { loadEnvConfig } from "@next/env";
import { PrismaClient, type Prisma } from "@prisma/client";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

const isDev = process.env.NODE_ENV !== "production";

// Ensure env vars are loaded when running in dev/Turbopack before Next processes them.
if (!process.env.__NEXT_PROCESSED_ENV) {
  loadEnvConfig(process.cwd());
}

// Neon serverless driver uses WebSockets in Node.js.
neonConfig.webSocketConstructor = ws;

// Turbopack-safe global singleton
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function makeClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Prisma v7 runtime needs an adapter; for Neon set DATABASE_URL to your pooler connection string."
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

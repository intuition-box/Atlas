import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  // Where your Prisma schema lives
  schema: path.join('prisma', 'schema.prisma'),

  // Migrate settings (optional but nice to be explicit)
  migrations: {
    // Keep migrations next to your schema
    path: path.join('prisma', 'migrations'),

    // Seed command: node/ts-node/tsx
    // seed: 'tsx prisma/seed.ts',
    // initShadowDb: '/* optional SQL for shadow DB bootstrap */',
  },

  // Optional extras if/when you need them:
  // views: { path: path.join('prisma', 'views') },
  // typedSql: { path: path.join('prisma', 'queries') },

  datasource: {
    // Prisma CLI (migrate, db push, studio) should use a direct (non-pooled) connection.
    // For Neon, set the variable to the non-pooler connection string.
    url: env('DATABASE_URL_UNPOOLED'),
  },

  // experimental: { adapter: false, externalTables: false, studio: false },
});
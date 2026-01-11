import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { HandleOwnerType } from "@prisma/client";

import { db } from "@/lib/database";
import { ROUTES } from "@/lib/routes";

const isDev = process.env.NODE_ENV !== "production";

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`${name} is required`);
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function discordImageUrl(profile: unknown, fallback: string | null | undefined): string | null {
  if (isRecord(profile)) {
    return (
      readString(profile, "image_url") ??
      readString(profile, "avatar_url") ??
      readString(profile, "picture") ??
      fallback ??
      null
    );
  }
  return fallback ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers: [
    Discord({
      clientId: requiredEnv("AUTH_DISCORD_ID"),
      clientSecret: requiredEnv("AUTH_DISCORD_SECRET"),
    }),
  ],
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SEC },
  secret: requiredEnv("AUTH_SECRET"),
  pages: {
    signIn: ROUTES.signIn,
  },
  trustHost: true,
  debug: isDev,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "discord") return true;

      const discordId = account.providerAccountId;
      const imageUrl = discordImageUrl(profile, user.image);

      try {
        await db.user.update({
          where: { id: user.id },
          data: {
            discordId,
            // For now store provider image URL; later we can mirror to R2 and overwrite.
            avatarUrl: imageUrl,
            image: imageUrl,
          },
          select: { id: true },
        });
      } catch (err) {
        // Don't block sign-in if this write fails.
        if (isDev) console.warn("[auth] failed to persist discord profile fields", err);
      }

      return true;
    },
    async session({ session, user }) {
      if (!session.user) return session;

      session.user.id = user.id;

      // AdapterUser typing does not include our custom columns, so refetch.
      const [dbUser, owner] = await Promise.all([
        db.user.findUnique({
          where: { id: user.id },
          select: {
            avatarUrl: true,
            image: true,
          },
        }),
        db.handleOwner.findUnique({
          where: {
            ownerType_ownerId: {
              ownerType: HandleOwnerType.USER,
              ownerId: user.id,
            },
          },
          select: { handle: { select: { name: true } } },
        }),
      ]);

      session.user.avatarUrl = dbUser?.avatarUrl ?? dbUser?.image ?? user.image ?? null;
      session.user.handle = owner?.handle.name ?? null;
      session.user.onboarded = Boolean(session.user.handle);

      return session;
    },
  },
});
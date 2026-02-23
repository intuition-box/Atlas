import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import Twitter from "next-auth/providers/twitter";
import { HandleOwnerType } from "@prisma/client";

import { db } from "@/lib/db/client";
import { mirrorUrlToR2 } from "@/lib/r2";
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

function isExternalUrl(url: string): boolean {
  const r2Base = process.env.R2_PUBLIC_BASE_URL;
  return !r2Base || !url.includes(r2Base);
}

/** Mirror an external avatar URL to R2, then update the user record. */
function mirrorAvatarToR2(userId: string, externalUrl: string) {
  const nonce = crypto.randomUUID();
  mirrorUrlToR2({ url: externalUrl, key: `avatars/users/${userId}/${nonce}.png` })
    .then((r2Url) => {
      if (!r2Url) return;
      return db.user.update({
        where: { id: userId },
        data: { avatarUrl: r2Url },
        select: { id: true },
      });
    })
    .catch((err) => {
      if (isDev) console.warn("[auth] failed to mirror avatar to R2", err);
    });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers: [
    Discord({
      clientId: requiredEnv("AUTH_DISCORD_ID"),
      clientSecret: requiredEnv("AUTH_DISCORD_SECRET"),
    }),
    ...(process.env.AUTH_X_ID
      ? [
          Twitter({
            clientId: process.env.AUTH_X_ID,
            clientSecret: process.env.AUTH_X_SECRET!,
          }),
        ]
      : []),
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
      if (account?.provider === "discord") {
        const discordId = account.providerAccountId;
        const imageUrl = discordImageUrl(profile, user.image);
        const discordHandle = readString(profile as Record<string, unknown>, "username") ?? null;

        try {
          await db.user.update({
            where: { id: user.id },
            data: {
              discordId,
              discordHandle,
              avatarUrl: imageUrl,
              image: imageUrl,
              lastActiveAt: new Date(),
            },
            select: { id: true },
          });

          // Mirror external avatar to R2 in the background (non-blocking).
          // Only mirror if the user doesn't already have an R2-hosted avatar.
          if (imageUrl && user.id) {
            const existing = await db.user.findUnique({
              where: { id: user.id },
              select: { avatarUrl: true },
            });
            if (!existing?.avatarUrl || isExternalUrl(existing.avatarUrl)) {
              mirrorAvatarToR2(user.id, imageUrl);
            }
          }
        } catch (err) {
          // Don't block sign-in if this write fails.
          if (isDev) console.warn("[auth] failed to persist discord profile fields", err);
        }
      }

      if (account?.provider === "twitter") {
        const twitterId = account.providerAccountId;
        const twitterHandle =
          readString(profile as Record<string, unknown>, "username") ??
          readString((profile as Record<string, unknown>)?.data as Record<string, unknown> ?? {}, "username") ??
          null;

        try {
          await db.user.update({
            where: { id: user.id },
            data: { twitterId, twitterHandle, lastActiveAt: new Date() },
            select: { id: true },
          });
        } catch (err) {
          if (isDev) console.warn("[auth] failed to persist twitter profile fields", err);
        }
      }

      return true;
    },
    async session({ session, user, trigger, newSession }) {
      if (!session.user) return session;

      session.user.id = user.id;

      // When update() is called with data (e.g. after onboarding), merge the
      // provided values first. This avoids a race where the DB query below
      // might not yet see a freshly committed handle/onboarded row.
      if (trigger === "update" && newSession && typeof newSession === "object") {
        const ns = newSession as Record<string, unknown>;
        if (typeof ns.handle === "string") session.user.handle = ns.handle;
        if (typeof ns.onboarded === "boolean") session.user.onboarded = ns.onboarded;
      }

      // AdapterUser typing does not include our custom columns, so refetch.
      const [dbUser, owner] = await Promise.all([
        db.user.findUnique({
          where: { id: user.id },
          select: {
            avatarUrl: true,
            image: true,
            onboardedAt: true,
            walletAddress: true,
            discordHandle: true,
            twitterHandle: true,
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

      // Raw OAuth image (e.g. Discord CDN URL) — used for onboarding preview.
      session.user.image = dbUser?.image ?? user.image ?? null;
      // Preferred avatar (may be an R2-mirrored URL after onboarding).
      session.user.avatarUrl = dbUser?.avatarUrl ?? session.user.image ?? null;
      // DB is authoritative, but fall back to the value from update() if the
      // DB query hasn't picked up the new handle yet.
      session.user.handle = owner?.handle.name ?? session.user.handle ?? null;
      session.user.onboarded = Boolean(dbUser?.onboardedAt) || session.user.onboarded;
      session.user.walletAddress = dbUser?.walletAddress ?? null;
      session.user.discordHandle = dbUser?.discordHandle ?? null;
      session.user.twitterHandle = dbUser?.twitterHandle ?? null;

      return session;
    },
  },
});
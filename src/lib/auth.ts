import "server-only";

import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { db } from "@/lib/db";

const isDev = process.env.NODE_ENV !== "production";

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers: [
    Discord({
      clientId: requiredEnv("AUTH_DISCORD_ID"),
      clientSecret: requiredEnv("AUTH_DISCORD_SECRET"),
      // default scope includes identify + email; add more scopes later if needed
    }),
  ],
  session: { strategy: "database" },
  secret: requiredEnv("AUTH_SECRET"),
  trustHost: true,
  debug: isDev,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "discord") return true;

      const discordId = account.providerAccountId;

      // Best-effort provider avatar URL.
      // Note: Discord profile shapes can vary across versions; keep it defensive.
      const imageUrl =
        (profile as any)?.image_url ??
        (profile as any)?.avatar_url ??
        (profile as any)?.picture ??
        user.image ??
        null;

      // Keep app-specific identity fields in sync (avoid crashing sign-in on a bad write).
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
      } catch {
        // If this fails, we still allow sign-in; the profile can be completed later.
      }

      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        (session.user as any).id = user.id;
        (session.user as any).avatarUrl = (user as any).avatarUrl ?? user.image ?? null;
        (session.user as any).handle = (user as any).handle ?? null;
      }
      return session;
    },
  },
});
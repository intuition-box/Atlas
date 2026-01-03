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
      clientId: requiredEnv("DISCORD_CLIENT_ID"),
      clientSecret: requiredEnv("DISCORD_CLIENT_SECRET"),
      // default scope includes identify + email; add more scopes later if needed
    }),
  ],
  session: { strategy: "database" },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  debug: isDev,
  callbacks: {
    async signIn({ user, account, profile }) {
      // Keep our app-specific identity fields in sync.
      if (account?.provider === "discord") {
        const discordId = account.providerAccountId;
        const imageUrl = (profile as any)?.image_url ?? user.image ?? null;

        // Avoid unnecessary writes.
        await db.user.update({
          where: { id: user.id },
          data: {
            discordId,
            // For now, store the provider image URL; later we can mirror to R2 and overwrite.
            avatarUrl: imageUrl,
            image: imageUrl,
          },
          select: { id: true },
        });
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
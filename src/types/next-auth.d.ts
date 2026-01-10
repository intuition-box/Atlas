import type { DefaultSession, DefaultUser } from "next-auth";

/**
 * NextAuth/Auth.js module augmentation.
 *
 * Auth.js is the upstream project name, but the Next.js adapter still exposes types
 * from the `next-auth` package in this codebase.
 */

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      avatarUrl: string | null;
      handle: string | null;
      onboarded: boolean;
      authAt?: string | null;
    };
  }

  interface User extends DefaultUser {
    avatarUrl?: string | null;
    handleId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    avatarUrl?: string | null;
    handle?: string | null;
    onboarded?: boolean;
    authAt?: string | null;
  }
}

export {};

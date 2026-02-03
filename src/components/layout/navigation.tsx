"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

import { Button } from "@/components/ui/button";
import Logo from "@/components/brand/logo";
import { ROUTES } from "@/lib/routes";

const HIDDEN_PATHS = [ROUTES.signIn];

export function Navigation() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const isAuthed = status === "authenticated" && !!session?.user;

  if (HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return null;
  }

  return (
    <header className="absolute group fixed z-50 flex flex-col p-6 text-sm text-white/60">
      <Logo />
      <nav className="ml-auto flex flex-col gap-2 py-4 transition-all duration-200">
        {isAuthed && (
          <Button
            variant="link"
            type="button"
            className="p-0 m-0 h-auto"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Sign out
          </Button>
        )}

        {!isAuthed && status !== "loading" && (
          <Button variant="link" className="p-0 m-0 h-auto">
            <Link href={ROUTES.signIn} aria-label="Connect socials to continue">
              Connect
            </Link>
          </Button>
        )}
      </nav>
    </header>
  );
}

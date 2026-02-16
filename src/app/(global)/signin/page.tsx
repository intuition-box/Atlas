import Link from "next/link";

import { signIn } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";
import { db } from "@/lib/db/client";

import { Button } from "@/components/ui/button";
import Logo from "@/components/brand/logo";
import OrbitAnimation from "../../../components/users/signin-animation";

export const dynamic = "force-dynamic";

type SearchParams = {
  returnTo?: string;
};

function sanitizeReturnTo(value: string | undefined) {
  if (!value) return ROUTES.home;
  // Only allow in-app relative redirects
  if (!value.startsWith("/")) return ROUTES.home;
  // Prevent protocol-relative redirects (//evil.com)
  if (value.startsWith("//")) return ROUTES.home;
  return value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const returnTo = sanitizeReturnTo(searchParams?.returnTo);

  // Pick a small pool of real avatars for the orbit (server-side).
  const avatarRows = await db.user.findMany({
    where: {
      avatarUrl: { not: null },
    },
    select: { avatarUrl: true },
    take: 16,
    orderBy: { updatedAt: "desc" },
  });

  const avatarUrls = avatarRows
    .map((r) => r.avatarUrl)
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0);

  // No redirect here - let providers.tsx OnboardingGuard handle all routing logic

  async function signinDiscord() {
    "use server";
    await signIn("discord", { redirectTo: returnTo });
  }

  return (
    <div className="flex flex-col min-h-screen w-full space-y-8 items-center justify-center">
      <div className="overflow-hidden w-full max-w-[460px] border rounded-[40px]">
        <div className="-mt-12 relative w-full aspect-square inset-0 flex items-center justify-center overflow-hidden">
          <OrbitAnimation className="" avatarUrls={avatarUrls} />
          <Logo className="absolute inset-0 flex items-center justify-center" />
        </div>

        <div className="relative -mt-12 px-6 pb-6">
          <p className="font-display pb-4 pt-8 text-center uppercase text-xl">
            Sign in to join communities
          </p>

          <div className="space-y-3">
            <form action={signinDiscord}>
              <Button type="submit" className="w-full py-6 text-base">
                Continue with Discord
              </Button>
            </form>
            <form>
              <Button disabled variant="secondary" type="submit" className="w-full py-6 text-base">
                Continue with X
              </Button>
            </form>
            <form>
              <Button disabled variant="secondary" type="submit" className="w-full py-6 text-base">
                Continue with Github
              </Button>
            </form>
          </div>
        </div> 
      </div>

      <p className="max-w-[240px] text-center text-xs text-white/45">
        By continuing, you agree to our <Link href="/terms" className="text-foreground hover:text-primary">Terms</Link> and acknowledge our <Link href="/privacy" className="text-foreground hover:text-primary">Privacy Policy</Link>.
      </p>
    </div>
  );
}
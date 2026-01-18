import { redirect } from "next/navigation";
import Link from "next/link";

import { auth, signIn } from "@/lib/auth";
import { ROUTES } from "@/lib/routes";

import { Button } from "@/components/ui/button";
import Logo from "@/components/brand/logo";

export const dynamic = "force-dynamic";

type SearchParams = {
  returnTo?: string;
};

function sanitizeReturnTo(value: string | undefined) {
  if (!value) return ROUTES.onboarding;
  // Only allow in-app relative redirects
  if (!value.startsWith("/")) return ROUTES.onboarding;
  // Prevent protocol-relative redirects (//evil.com)
  if (value.startsWith("//")) return ROUTES.onboarding;
  return value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await auth();
  const authed = !!(session?.user as any)?.id;
  const returnTo = sanitizeReturnTo(searchParams?.returnTo);

  if (authed) redirect(returnTo);

  async function signinDiscord() {
    "use server";
    await signIn("discord", { redirectTo: returnTo });
  }

  return (
    <div className="flex flex-col min-h-screen w-full space-y-8 items-center justify-center">

      {/* Wrapper Card */}
      <div className="relative z-10 w-full max-w-[460px] px-6 border border-surface3 bg-surface1 rounded-[32px]">

        {/* Background Animation Container */}
        <div className="relative h-[400px] w-[400px] inset-0 flex items-center justify-center overflow-hidden">

          <div className="absolute aspect-square w-full animate-spin-slow">
            
            {/* Animated avatars */}


            {/* Animated orbits */}
            <div className="absolute inset-0 flex items-center justify-center">
              <svg height="720" width="360" className="absolute">
                <defs>
                  <linearGradient x1="0.194" x2="1" y1="0.190" y2="0.671" id="gradInner">
                    <stop stopColor="#999" stopOpacity="0"></stop>
                    <stop offset="0.47" stopColor="#999"></stop>
                    <stop offset="1" stopColor="#999" stopOpacity="0"></stop>
                  </linearGradient>
                  <linearGradient x1="-0.0229" x2="1.0686" y1="0.525" y2="0.599" id="gradOuter">
                    <stop stopColor="#999999" stopOpacity="0"></stop>
                    <stop offset="0.47" stopColor="#999999"></stop>
                    <stop offset="1" stopColor="#999999" stopOpacity="0"></stop>
                  </linearGradient>
                </defs>
                <circle cx="180" cy="360" fill="none" r="106" stroke="url(#gradInner)" strokeOpacity="0.2" strokeWidth="1"></circle>
                <circle cx="180" cy="360" fill="none" r="190" stroke="url(#gradOuter)" strokeOpacity="0.2" strokeWidth="1"></circle>
              </svg>
            </div>

            {/* Animated logo */}
            <div className="absolute inset-0 flex items-center justify-center _display-flex _alignItems-stretch _flexBasis-auto _boxSizing-border-box _minHeight-0px _minWidth-0px _flexShrink-0 _flexDirection-column _alignSelf-center _position-absolute">
              <Logo />
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="relative -mt-xl px-6 pb-6">
          <p className="pb-4 pt-8 text-center text-sm text-foreground/60">
            Sign in to join communities.
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
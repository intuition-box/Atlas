import Link from "next/link";

import { signIn } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";
import { db } from "@/lib/db/client";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
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
  searchParams?: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const returnTo = sanitizeReturnTo(params?.returnTo);

  // Pick a small pool of real avatars for the orbit (server-side).
  const [avatarRows, recentAttestations, newestUsers, verifiedUsers] = await Promise.all([
    db.user.findMany({
      where: { avatarUrl: { not: null } },
      select: { avatarUrl: true },
      take: 16,
      orderBy: { updatedAt: "desc" },
    }),
    // Fetch recent attestation pairs for the handshake + follow items
    db.attestation.findMany({
      where: {
        revokedAt: null,
        supersededById: null,
        fromUser: { avatarUrl: { not: null } },
        toUser: { avatarUrl: { not: null } },
      },
      select: {
        fromUser: { select: { avatarUrl: true } },
        toUser: { select: { avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // Recently created users — pick the first one not in attestation/follow pairs
    db.user.findMany({
      where: { avatarUrl: { not: null } },
      select: { avatarUrl: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // Recently onboarded users (have a handle) — for the verified ✅ item
    db.user.findMany({
      where: { avatarUrl: { not: null }, onboarded: true },
      select: { avatarUrl: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  const avatarUrls = avatarRows
    .map((r) => r.avatarUrl)
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0);

  // Pick two non-overlapping attestation pairs so no face repeats
  let attestationPair: [string, string] | undefined;
  let followPair: [string, string] | undefined;

  for (const att of recentAttestations) {
    const from = att.fromUser.avatarUrl!;
    const to = att.toUser.avatarUrl!;

    if (!attestationPair) {
      attestationPair = [from, to];
    } else if (
      !followPair &&
      from !== attestationPair[0] &&
      from !== attestationPair[1] &&
      to !== attestationPair[0] &&
      to !== attestationPair[1]
    ) {
      followPair = [from, to];
      break;
    }
  }

  // Pick dedicated avatars that don't clash with each other or attestation/follow pairs
  const reservedUrls = new Set([
    ...(attestationPair ?? []),
    ...(followPair ?? []),
  ]);

  const newestMemberUrl = newestUsers
    .find((u) => u.avatarUrl && !reservedUrls.has(u.avatarUrl))
    ?.avatarUrl ?? undefined;
  if (newestMemberUrl) reservedUrls.add(newestMemberUrl);

  const verifiedMemberUrl = verifiedUsers
    .find((u) => u.avatarUrl && !reservedUrls.has(u.avatarUrl))
    ?.avatarUrl ?? undefined;
  if (verifiedMemberUrl) reservedUrls.add(verifiedMemberUrl);

  // No redirect here - let providers.tsx OnboardingGuard handle all routing logic

  async function signinDiscord() {
    "use server";
    await signIn("discord", { redirectTo: returnTo });
  }

  return (
    <div className="flex flex-col min-h-screen w-full space-y-8 items-center justify-center">
      <div className="overflow-hidden w-full max-w-[460px] border rounded-[40px]">
        <div className="-mt-12 relative w-full aspect-square inset-0 flex items-center justify-center overflow-hidden">
          <OrbitAnimation className="" avatarUrls={avatarUrls} attestationPair={attestationPair} followPair={followPair} newestMemberUrl={newestMemberUrl} verifiedMemberUrl={verifiedMemberUrl} />
          <div className="absolute inset-0 flex items-center justify-center">
            <Logo className="size-12"/>
          </div>
        </div>

        <div className="relative -mt-12 px-6 pb-6">
          <p className="font-display pb-4 pt-16 text-center text-xl">
            Sign in to join communities
          </p>

          <div className="space-y-3">
            <form action={signinDiscord}>
              <Button type="submit" variant="solid" className="w-full py-6 text-base">
                Continue with Discord
              </Button>
            </form>
            <div className="flex gap-2">
              <Button disabled variant="secondary" className="flex-1 py-6 text-base relative">
                Github
                <span className="absolute -top-1 right-2 rounded-full bg-muted px-2 py-0 text-xs">soon</span>
              </Button>
              <Button disabled variant="secondary" className="flex-1 py-6 text-base relative">
                X
                <span className="absolute -top-1 right-2 rounded-full bg-muted px-2 py-0 text-xs">soon</span>
              </Button>
              <Button disabled variant="secondary" className="flex-1 py-6 text-base relative">
                Telegram
                <span className="absolute -top-1 right-2 rounded-full bg-muted px-2 py-0 text-xs">soon</span>
              </Button>
            </div>
          </div>
        </div> 
      </div>

      <p className="max-w-[240px] text-center text-xs text-white/45">
        By continuing, you agree to our <Link href="/terms" className="text-foreground hover:text-primary">Terms</Link> and acknowledge our <Link href="/policy" className="text-foreground hover:text-primary">Privacy Policy</Link>.
      </p>
    </div>
  );
}
import { redirect } from "next/navigation";

import { auth, signIn } from "@/lib/auth";

export const dynamic = "force-dynamic";

type SearchParams = {
  returnTo?: string;
};

function sanitizeReturnTo(value: string | undefined) {
  if (!value) return "/onboarding";
  // Only allow in-app relative redirects.
  if (!value.startsWith("/")) return "/onboarding";
  // Prevent protocol-relative redirects (//evil.com).
  if (value.startsWith("//")) return "/onboarding";
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
    <div className="mx-auto max-w-sm px-6 py-24 text-center">
      <h1 className="mb-2 text-xl font-semibold tracking-tight text-foreground">
        Sign in
      </h1>
      <p className="mb-8 text-sm text-foreground/70">
        Continue with Discord to join communities.
      </p>

      <form action={signinDiscord} className="space-y-3">
        <button
          type="submit"
          className="w-full rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-muted"
        >
          Continue with Discord
        </button>
      </form>
    </div>
  );
}

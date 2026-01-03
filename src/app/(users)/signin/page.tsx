import Link from "next/link";
import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams?: { provider?: string; returnTo?: string } }) {
  const session = await auth();
  const authed = !!(session?.user as any)?.id;
  const returnTo = searchParams?.returnTo || "/welcome";
  if (authed) redirect(returnTo);

  async function signinDiscord() {
    "use server";
    await signIn("discord", { redirectTo: returnTo });
  }
  async function signinGithub() {
    "use server";
    await signIn("github", { redirectTo: returnTo });
  }
  async function signinTwitter() {
    "use server";
    await signIn("twitter", { redirectTo: returnTo });
  }

  return (
    <div className="mx-auto max-w-sm py-24 text-center">
      <h1 className="text-xl text-white mb-6">Sign in</h1>
      <div className="space-y-3">
        <form action={signinDiscord}>
          <button className="w-full rounded-full border border-white/15 px-4 py-2 text-white/90 hover:border-white/30 hover:bg-white/5">
            Continue with Discord
          </button>
        </form>
        <form action={signinGithub}>
          <button className="w-full rounded-full border border-white/15 px-4 py-2 text-white/90 hover:border-white/30 hover:bg-white/5">
            Continue with GitHub
          </button>
        </form>
        <form action={signinTwitter}>
          <button className="w-full rounded-full border border-white/15 px-4 py-2 text-white/90 hover:border-white/30 hover:bg-white/5">
            Continue with X (Twitter)
          </button>
        </form>
      </div>
    </div>
  );
}

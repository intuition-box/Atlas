import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/guards";
import * as routes from "@/lib/routes";

export default async function DashboardPage() {
  // Auth is allowed here; avoid direct DB access in pages.
  let userId: string;
  try {
    ({ userId } = await requireAuth());
  } catch {
    // Prefer route helpers when available; fall back to NextAuth sign-in.
    const signIn = (routes as any).SIGNIN_PATH ?? (routes as any).signInPath ?? "/api/auth/signin";
    redirect(signIn);
  }

  const newCommunityHref =
    (routes as any).NEW_PATH ??
    (routes as any).newCommunityPath ??
    (routes as any).communityNewPath ??
    "/new";

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm opacity-70">Your communities and admin tools.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={newCommunityHref} className="rounded-xl border px-3 py-2 text-sm opacity-80 hover:opacity-100">
            New community
          </Link>
        </div>
      </header>

      <section className="mt-8">
        <div className="text-sm font-medium">Your communities</div>
        <p className="mt-2 text-sm opacity-70">
          Open <Link href={newCommunityHref} className="underline underline-offset-4">New community</Link> to create your first community, then it will appear here.
        </p>
      </section>
    </main>
  );
}

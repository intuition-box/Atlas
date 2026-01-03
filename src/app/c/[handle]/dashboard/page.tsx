import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveHandleForOwner, normalizeHandleKey, resolveCommunityIdFromHandle } from "@/lib/handle";

export default async function DashboardPage(props: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await props.params;
  const routeHandle = normalizeHandleKey(raw);

  const communityId = await resolveCommunityIdFromHandle(routeHandle);
  if (!communityId) return notFound();

  const community = await db.community.findUnique({
    where: { id: communityId },
    select: {
      id: true,
      name: true,
      description: true,
      avatarUrl: true,
      ownerId: true,
      isPublicDirectory: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!community) return notFound();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/api/auth/signin");

  if (community.ownerId !== userId) return notFound();

  const activeHandle = await getActiveHandleForOwner({
    ownerType: "COMMUNITY",
    ownerId: community.id,
  });

  const canonicalHandle = activeHandle ?? routeHandle;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{community.name} dashboard</h1>
          <p className="mt-1 text-sm opacity-60">@{canonicalHandle}</p>
          {community.description ? (
            <p className="mt-2 text-sm opacity-70">{community.description}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/c/${canonicalHandle}`}
            className="rounded-xl border px-3 py-2 text-sm opacity-80 hover:opacity-100"
          >
            View community
          </Link>
          <Link
            href={`/c/${canonicalHandle}/settings`}
            className="rounded-xl border px-3 py-2 text-sm opacity-80 hover:opacity-100"
          >
            Settings
          </Link>
        </div>
      </header>

      <section className="mt-8 rounded-xl border p-4">
        <div className="text-sm font-medium">MVP dashboard</div>
        <p className="mt-1 text-sm opacity-70">
          Next: pending applications, approve/reject, member list.
        </p>
      </section>
    </main>
  );
}

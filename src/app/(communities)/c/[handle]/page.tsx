import Link from "next/link";
import { notFound } from "next/navigation";

import OrbitView from "@/components/orbit/orbit-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/database";
import {
  getActiveHandleForOwner,
  normalizeHandle,
  resolveCommunityIdFromHandle,
} from "@/lib/handle";

export default async function CommunityPage(props: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await props.params;
  const routeHandle = normalizeHandle(raw);

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
    },
  });

  if (!community) return notFound();

  const activeHandle = await getActiveHandleForOwner({
    ownerType: "COMMUNITY",
    ownerId: community.id,
  });

  // With handle-only routing, this should normally match `routeHandle`.
  const canonicalHandle = activeHandle ?? routeHandle;

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;

  const viewerMembership = viewerId
    ? await db.membership.findUnique({
        where: { userId_communityId: { userId: viewerId, communityId: community.id } },
        select: { status: true, role: true },
      })
    : null;

  const isAdmin =
    !!viewerId &&
    (community.ownerId === viewerId ||
      viewerMembership?.role === "OWNER" ||
      viewerMembership?.role === "ADMIN");

  const canViewDirectory =
    community.isPublicDirectory || viewerMembership?.status === "APPROVED";
  const members = canViewDirectory
    ? await db.membership.findMany({
        where: { communityId: community.id, status: "APPROVED" },
        orderBy: { gravityScore: "desc" },
        select: {
          userId: true,
          orbitLevel: true,
          reachScore: true,
          lastActiveAt: true,
          user: {
            select: {
              name: true,
              avatarUrl: true,
              headline: true,
              tags: true,
            },
          },
        },
        take: 800, // guardrail; increase later with pagination/virtualization
      })
    : [];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-start gap-4">
        <div className="h-12 w-12 overflow-hidden rounded-xl border bg-black/5 dark:bg-white/10">
          {community.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={community.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{community.name}</h1>
              <p className="mt-1 text-sm opacity-60">@{canonicalHandle}</p>
            </div>

            <div className="flex items-center gap-2">
              {viewerMembership?.status === "APPROVED" ? (
                <span className="rounded-full border px-2 py-1 text-xs opacity-70">
                  Member
                </span>
              ) : null}

              {isAdmin ? (
                <Link
                  href={`/c/${canonicalHandle}/dashboard`}
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Dashboard
                </Link>
              ) : null}
            </div>
          </div>

          {community.description ? (
            <p className="mt-1 text-sm opacity-70">{community.description}</p>
          ) : (
            <p className="mt-1 text-sm opacity-50">No description yet.</p>
          )}
        </div>
      </header>

      {!canViewDirectory ? (
        <section className="rounded-xl border p-5">
          <h2 className="text-lg font-medium">Directory is members-only</h2>
          <p className="mt-1 text-sm opacity-70">
            Apply to join to view the network and member profiles.
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              href={`/c/${canonicalHandle}/apply`}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              Apply
            </Link>
            <Link
              href="/"
              className="rounded-lg border px-3 py-2 text-sm opacity-70 hover:bg-black/5 dark:hover:bg-white/10"
            >
              Back
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium opacity-80">Network</h2>
            <span className="text-xs opacity-60">{members.length} approved</span>
          </div>

          <OrbitView
            centerTitle={community.name}
            centerSubtitle={(community.description ?? "").trim() || undefined}
            members={members.map((m) => ({
              id: m.userId,
              name: m.user.name ?? "Unknown",
              avatarUrl: m.user.avatarUrl,
              headline: m.user.headline,
              tags: m.user.tags,
              orbitLevel: m.orbitLevel,
              reachScore: m.reachScore,
              lastActiveAt: m.lastActiveAt?.toISOString() ?? null,
            }))}
          />
        </section>
      )}
    </main>
  );
}
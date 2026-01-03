import Link from "next/link";
import { db } from "@/lib/db";

export default async function Home() {
  const communities = await db.community.findMany({
    take: 24,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      avatarUrl: true,
      isPublicDirectory: true,
      _count: { select: { memberships: true } },
      memberships: {
        where: { status: "APPROVED" },
        take: 10,
        orderBy: { gravityScore: "desc" },
        select: { user: { select: { id: true, avatarUrl: true, name: true } } },
      },
    },
  });

  const communityIds = communities.map((c) => c.id);

  const handles = communityIds.length
    ? await db.handle.findMany({
        where: {
          status: "ACTIVE",
          ownerType: "COMMUNITY",
          ownerId: { in: communityIds },
        },
        select: { ownerId: true, handle: true },
      })
    : [];

  const handleByCommunityId = new Map(handles.map((h) => [h.ownerId!, h.handle] as const));

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Communities</h1>
          <p className="text-sm opacity-70">Explore networks and apply to join.</p>
        </div>
        <Link
          href="/community/new"
          className="rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
        >
          Create community
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {communities.map((c) => {
          const handle = handleByCommunityId.get(c.id);
          if (!handle) return null;

          return (
            <Link
              key={c.id}
              href={`/c/${handle}`}
              className="rounded-xl border p-4 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 overflow-hidden rounded-lg border bg-black/5 dark:bg-white/10">
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-xs opacity-60">@{handle}</div>
                  </div>
                  {c.description ? (
                    <p className="mt-1 line-clamp-2 text-sm opacity-70">{c.description}</p>
                  ) : (
                    <p className="mt-1 text-sm opacity-50">No description yet.</p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {c.memberships.map((m) => (
                    <div
                      key={m.user.id}
                      className="h-7 w-7 overflow-hidden rounded-full border bg-black/5 dark:bg-white/10"
                      title={m.user.name ?? ""}
                    >
                      {m.user.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                  ))}
                </div>
                <span className="text-xs opacity-60">
                  {c.isPublicDirectory ? "Public directory" : "Members only"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
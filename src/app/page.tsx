import Link from "next/link";

import { db } from "@/lib/db";

export default async function Home() {
  const communities = await db.community.findMany({
    take: 24,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      handle: true,
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

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Communities</h1>
          <p className="text-sm text-foreground/70">
            Explore networks and apply to join.
          </p>
        </div>

        <Link
          href="/community/new"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted"
        >
          Create community
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {communities.map((c) => {
          if (!c.handle) return null;

          return (
            <Link
              key={c.id}
              href={`/c/${c.handle}`}
              className="rounded-xl border border-border bg-background p-4 hover:bg-muted"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-muted">
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col">
                    <div className="truncate font-medium text-foreground">{c.name}</div>
                    <div className="text-xs text-foreground/60">@{c.handle}</div>
                  </div>

                  {c.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-foreground/70">
                      {c.description}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-foreground/50">No description yet.</p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {c.memberships.map((m) => (
                    <div
                      key={m.user.id}
                      className="h-7 w-7 overflow-hidden rounded-full border border-border bg-muted"
                      title={m.user.name ?? ""}
                    >
                      {m.user.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.user.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                  ))}
                </div>

                <span className="text-xs text-foreground/60">
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
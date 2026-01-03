import Link from "next/link";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export default async function CommunitiesIndexPage() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;

  const handles = await db.handle.findMany({
    where: { status: "ACTIVE", ownerType: "COMMUNITY" },
    select: { handle: true, ownerId: true },
    orderBy: { handle: "asc" },
    take: 500,
  });

  const communityIds = handles.map((h) => h.ownerId!).filter(Boolean);

  const communities = communityIds.length
    ? await db.community.findMany({
        where: { id: { in: communityIds } },
        select: { id: true, name: true, description: true, avatarUrl: true, isPublicDirectory: true },
      })
    : [];

  const byId = new Map(communities.map((c) => [c.id, c] as const));

  const rows = handles
    .map((h) => {
      const c = h.ownerId ? byId.get(h.ownerId) : null;
      return c
        ? {
            id: c.id,
            handle: h.handle,
            name: c.name,
            description: c.description,
            avatarUrl: c.avatarUrl,
            isPublicDirectory: c.isPublicDirectory,
          }
        : null;
    })
    .filter(Boolean) as Array<{
    id: string;
    handle: string;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    isPublicDirectory: boolean;
  }>;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Communities</h1>
          <p className="mt-1 text-sm opacity-70">Browse all active communities by handle.</p>
        </div>

        {userId ? (
          <Link
            href="/community/new"
            className="rounded-xl border px-3 py-2 text-sm font-medium opacity-90 hover:opacity-100"
          >
            New community
          </Link>
        ) : (
          <Link
            href="/api/auth/signin"
            className="rounded-xl border px-3 py-2 text-sm opacity-80 hover:opacity-100"
          >
            Sign in
          </Link>
        )}
      </header>

      {rows.length === 0 ? (
        <section className="rounded-xl border p-5">
          <div className="text-sm font-medium">No communities yet</div>
          <p className="mt-1 text-sm opacity-70">Create the first one to get started.</p>
          <div className="mt-4">
            <Link
              href="/community/new"
              className="rounded-xl border px-3 py-2 text-sm opacity-90 hover:opacity-100"
            >
              Create community
            </Link>
          </div>
        </section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <Link
              key={c.id}
              href={`/c/${c.handle}`}
              className="rounded-xl border p-4 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 overflow-hidden rounded-xl border bg-black/5 dark:bg-white/10">
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="mt-0.5 text-xs opacity-60">@{c.handle}</div>
                    </div>
                    {c.isPublicDirectory ? (
                      <span className="shrink-0 rounded-full border px-2 py-1 text-[11px] opacity-60">
                        Public
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border px-2 py-1 text-[11px] opacity-60">
                        Members
                      </span>
                    )}
                  </div>

                  {c.description ? (
                    <p className="mt-2 line-clamp-2 text-sm opacity-70">{c.description}</p>
                  ) : (
                    <p className="mt-2 text-sm opacity-50">No description yet.</p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
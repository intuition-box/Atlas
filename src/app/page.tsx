"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { rpcGet } from "@/lib/api-client";
import { ROUTE, ROUTES } from "@/lib/routes";

type CommunityListItem = {
  id: string;
  handle: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  isPublicDirectory: boolean;
  membersCount?: number;
  // Optional previews (depending on API shape)
  memberships?: Array<{
    user: { id: string; avatarUrl?: string | null; name?: string | null };
  }>;
  memberPreview?: Array<{ id: string; avatarUrl?: string | null; name?: string | null }>;
};

export default function Home() {
  const [communities, setCommunities] = useState<CommunityListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        // Public “universe” view: list communities that are public directories.
        // Keep params minimal; the API should own access rules.
        const data = await rpcGet<{ communities: CommunityListItem[] }>(
          "/api/community/list",
          { take: 24 },
        );

        if (!alive) return;

        const onlyPublic = (data.communities ?? []).filter((c) => c.isPublicDirectory);
        setCommunities(onlyPublic);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load communities");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void run();
    return () => {
      alive = false;
    };
  }, []);

  const emptyState = useMemo(() => {
    if (loading) return null;
    if (error) return null;
    if (communities.length > 0) return null;

    return (
      <div className="rounded-xl border border-border bg-background p-6 text-sm text-foreground/70">
        <p>
          No public communities yet.
        </p>
        <Link
          href={ROUTES.communityNew}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted"
        >
          Create community
        </Link>
      </div>
    );
  }, [communities.length, error, loading]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      {error ? (
        <div className="mb-4 rounded-xl border border-border bg-background p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              className="h-[124px] rounded-xl border border-border bg-background p-4"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg border border-border bg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
                  <div className="mt-3 h-3 w-full rounded bg-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {emptyState}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {communities.map((c) => {
              const avatars =
                c.memberPreview ?? c.memberships?.map((m) => m.user).filter(Boolean) ?? [];

              return (
                <Link
                  key={c.id}
                  href={ROUTE.community(c.handle)}
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
                      {avatars.slice(0, 10).map((u) => (
                        <div
                          key={u.id}
                          className="h-7 w-7 overflow-hidden rounded-full border border-border bg-muted"
                          title={u.name ?? ""}
                        >
                          {u.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <span className="text-xs text-foreground/60">Public directory</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import OrbitUniverse from "@/components/orbit/orbit-universe";
import { apiGet } from "@/lib/api-client";
import { ROUTES, communityPath } from "@/lib/routes";

type CommunityListItem = {
  id: string;
  handle: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  isPublicDirectory: boolean;
  membersCount?: number;
};

export default function Home() {
  const router = useRouter();

  const [communities, setCommunities] = useState<CommunityListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        // Keep the request GET-only. If the route rejects the query, treat it as an empty list.
        const r = await apiGet<{ communities: CommunityListItem[] }>("/api/community/list?take=50");

        if (!alive) return;

        if (!r.ok) {
          // Don’t show schema/validation copy on the homepage.
          // If the route returns INVALID_REQUEST, behave like “no communities yet”.
          if (r.error.code === "INVALID_REQUEST") {
            setCommunities([]);
            return;
          }

          throw new Error(r.error.message || "Failed to load communities");
        }

        const onlyPublic = (r.value.communities ?? []).filter((c) => c.isPublicDirectory);
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

  return (
    <main className="fixed inset-0 overflow-hidden">
      <OrbitUniverse
        communities={communities}
        onSelect={(c: { handle: string }) => router.push(communityPath(c.handle))}
      />

      {/* Status */}
      {error ? (
        <div className="pointer-events-auto absolute left-6 top-24 z-10 max-w-md rounded-xl border border-border bg-background p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="pointer-events-none absolute left-6 top-24 z-10 rounded-xl border border-border bg-background/80 p-3 text-sm text-foreground/70 backdrop-blur">
          Loading communities…
        </div>
      ) : null}

      {/* Empty state */}
      {!loading && !error && communities.length === 0 ? (
        <div className="pointer-events-auto absolute left-6 top-24 z-10">
          <div className="rounded-xl border border-border bg-background/80 p-4 text-sm text-foreground/80 shadow-sm backdrop-blur">
            <p>No public communities yet.</p>
            <div className="mt-3">
              <Link
                href={ROUTES.communityNew}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
              >
                Create community
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
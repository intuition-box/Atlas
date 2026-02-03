"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { OrbitUniverse, type OrbitCommunity, type OrbitLink } from "@/components/orbit/orbit-universe";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { apiGet } from "@/lib/api/client";
import { ROUTES, communityPath } from "@/lib/routes";

type OrbitUniverseResponse = {
  communities: OrbitCommunity[];
  links: OrbitLink[];
};

export default function Home() {
  const router = useRouter();
  
  const [communities, setCommunities] = useState<OrbitCommunity[]>([]);
  const [links, setLinks] = useState<OrbitLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        const res = await apiGet<OrbitUniverseResponse>("/api/orbit/universe");

        if (!alive) return;

        if (!res.ok) {
          throw new Error(res.error.message || "Failed to load communities");
        }

        setCommunities(res.value.communities ?? []);
        setLinks(res.value.links ?? []);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load communities");
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
        links={links}
        onSelect={(c) => router.push(communityPath(c.handle))}
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
        <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center">
          <Empty className="border-border bg-background/80 backdrop-blur">
            <EmptyHeader>
              <EmptyTitle>No public communities yet</EmptyTitle>
              <EmptyDescription>
                Be the first to create a community and start building your orbit.
              </EmptyDescription>
            </EmptyHeader>
            <Link
              href={ROUTES.communityNew}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted"
            >
              Create community
            </Link>
          </Empty>
        </div>
      ) : null}
    </main>
  );
}

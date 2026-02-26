"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";

import { apiGet } from "@/lib/api/client";
import { displayName as getDisplayName } from "@/lib/format";
import {
  userPath,
  userActivityPath,
  userAttestationsPath,
  userSettingsPath,
  communityPath,
} from "@/lib/routes";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useActivityFeed, type ActivityEvent } from "@/hooks/use-activity-feed";

import { EventFeed, type EventTypeConfig } from "@/components/activity/event-feed";
import { EventFiltersPanel } from "@/components/activity/event-filters-panel";
import { ListFeedSkeleton } from "@/components/common/list-feed";
import { PageHeader } from "@/components/common/page-header";
import { PageToolbar } from "@/components/common/page-toolbar";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──────────────────────────────────────────────────────────

type UserProfile = {
  name: string | null;
  avatarUrl: string | null;
  image: string | null;
};

type UserActivityEvent = ActivityEvent & {
  community: { id: string; handle: string | null; name: string } | null;
};

type FilterState = {
  q: string;
  type: string;
};

const EMPTY_FILTERS: FilterState = { q: "", type: "" };

// ── Event type config ──────────────────────────────────────────────

const EVENT_TYPE_CONFIG: Record<string, EventTypeConfig> = {
  JOINED: { label: "Joined", variant: "positive" },
  ATTESTED: { label: "Attestation", variant: "default" },
  ATTESTATION_RETRACTED: { label: "Retracted", variant: "destructive" },
  ATTESTATION_SUPERSEDED: { label: "Attestation Updated", variant: "secondary" },
};

const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_CONFIG).map(
  ([value, { label }]) => ({ value, label }),
);

// ── Hooks ──────────────────────────────────────────────────────────

function useUserProfile(handle: string) {
  const [profile, setProfile] = React.useState<UserProfile | null>(null);

  React.useEffect(() => {
    if (!handle) return;

    const ac = new AbortController();

    void (async () => {
      const res = await apiGet<{ user: UserProfile }>(
        "/api/user/get",
        { handle },
        { signal: ac.signal },
      );
      if (!ac.signal.aborted && res.ok) {
        setProfile(res.value.user);
      }
    })();

    return () => ac.abort();
  }, [handle]);

  return profile;
}

// ── Skeleton ───────────────────────────────────────────────────────

function ActivitySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-7 pb-40">
      <div className="w-full p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Skeleton className="size-12 rounded-full shrink-0" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-64 rounded-4xl" />
        </div>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle><Skeleton className="h-5 w-32" /></CardTitle>
          <CardDescription><Skeleton className="h-4 w-86" /></CardDescription>
        </CardHeader>
        <CardContent>
          <ListFeedSkeleton rows={8} />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────

export default function UserActivityPage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle?.trim() || "";
  const { data: session } = useSession();

  const isSelf = session?.user?.handle === handle;
  const profile = useUserProfile(handle);

  const displayName = profile?.name?.trim() || `@${handle}`;
  const avatarSrc = profile?.avatarUrl || profile?.image || "";

  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false);

  const debouncedQ = useDebouncedValue(filters.q, 300);
  const activeFilters = React.useMemo(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ],
  );

  // Fetch params — only `handle` is static
  const feedParams = React.useMemo(() => ({ handle }), [handle]);

  const { events, loading, loadingMore, hasMore, loadMore } =
    useActivityFeed<UserActivityEvent>({
      endpoint: "/api/user/activity/list",
      params: feedParams,
      filters: { type: activeFilters.type },
      enabled: !!handle,
    });

  // Client-side search filter
  const filteredEvents = React.useMemo(() => {
    if (!debouncedQ) return events;
    const q = debouncedQ.toLowerCase();
    return events.filter((e) => {
      const actorName = getDisplayName(e.actor).toLowerCase();
      const actorHandle = (e.actor.handle ?? "").toLowerCase();
      const subjectName = e.subject ? getDisplayName(e.subject).toLowerCase() : "";
      const subjectHandle = (e.subject?.handle ?? "").toLowerCase();
      const communityName = (e.community?.name ?? "").toLowerCase();
      return (
        actorName.includes(q) ||
        actorHandle.includes(q) ||
        subjectName.includes(q) ||
        subjectHandle.includes(q) ||
        communityName.includes(q)
      );
    });
  }, [events, debouncedQ]);

  const hasActive = Boolean(filters.q || filters.type);

  if (!handle) return null;

  if (loading && !profile) return <ActivitySkeleton />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar type="user" src={avatarSrc} name={displayName} className="h-12 w-12" />
        }
        title="Activity"
        description={`@${handle}`}
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            actions={[
              { label: "Filters", active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) },
            ]}
            nav={[
              { label: "Profile", href: userPath(handle) },
              { label: "Attestations", href: userAttestationsPath(handle) },
              { label: "Activity", href: userActivityPath(handle) },
              ...(isSelf ? [{ label: "Settings", href: userSettingsPath(handle) }] : []),
            ]}
          />
        }
      />

      {isFiltersOpen && (
        <EventFiltersPanel
          q={filters.q}
          filterValue={filters.type}
          filterLabel="Event type"
          filterOptions={EVENT_TYPE_OPTIONS}
          onSearchChange={(q) => setFilters((prev) => ({ ...prev, q }))}
          onFilterChange={(type) => setFilters((prev) => ({ ...prev, type }))}
          onClearAll={() => setFilters(EMPTY_FILTERS)}
          resultCount={filteredEvents.length}
          hasActiveFilters={hasActive}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Recent events across all communities.</CardDescription>
        </CardHeader>
        <CardContent>
          <EventFeed
            events={filteredEvents}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onLoadMore={loadMore}
            eventTypeConfig={EVENT_TYPE_CONFIG}
            renderExtra={(event) => {
              const e = event as UserActivityEvent;
              if (!e.community?.handle) return null;
              return (
                <span className="text-xs text-muted-foreground shrink-0">
                  in{" "}
                  <Link
                    href={communityPath(e.community.handle)}
                    className="hover:underline"
                  >
                    {e.community.name}
                  </Link>
                </span>
              );
            }}
            emptyMessage="No activity yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}

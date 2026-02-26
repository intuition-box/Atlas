"use client";

import * as React from "react";
import { useParams } from "next/navigation";

import { apiGet } from "@/lib/api/client";
import { parseApiError } from "@/lib/api/errors";
import { displayName } from "@/lib/format";
import { normalizeHandle, validateHandle } from "@/lib/handle";
import {
  communityPath,
  communityActivityPath,
  communityMembersPath,
  communityOrbitPath,
  communityApplicationsPath,
  communityBansPath,
  communityPermissionsPath,
  communitySettingsPath,
} from "@/lib/routes";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useActivityFeed } from "@/hooks/use-activity-feed";

import { EventFeed, type EventTypeConfig } from "@/components/activity/event-feed";
import { EventFiltersPanel } from "@/components/activity/event-filters-panel";
import { ListFeedSkeleton } from "@/components/common/list-feed";
import { PageHeader } from "@/components/common/page-header";
import { PageToolbar } from "@/components/common/page-toolbar";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──────────────────────────────────────────────────────────

type CommunityGetResponse = {
  community: {
    id: string;
    name: string;
    avatarUrl: string | null;
    isPublicDirectory: boolean;
  };
  isAdmin: boolean;
  canViewDirectory: boolean;
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
  ROLE_UPDATED: { label: "Role Change", variant: "info" },
  ORBIT_OVERRIDE: { label: "Orbit Override", variant: "info" },
};

const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_CONFIG).map(
  ([value, { label }]) => ({ value, label }),
);

// ── Skeleton ───────────────────────────────────────────────────────

function ActivitySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-7 pb-40">
      <div className="w-full p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Skeleton className="size-12 rounded-full shrink-0" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-3 w-24" />
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

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ready"; data: CommunityGetResponse };

export default function CommunityActivityPage() {
  const params = useParams<{ handle: string }>();
  const rawHandle = String(params?.handle ?? "");
  const handle = React.useMemo(() => normalizeHandle(rawHandle), [rawHandle]);

  const [state, setState] = React.useState<LoadState>({ status: "idle" });
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false);

  const debouncedQ = useDebouncedValue(filters.q, 300);
  const activeFilters = React.useMemo(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ],
  );

  // Fetch community data
  React.useEffect(() => {
    const parsed = validateHandle(handle);
    if (!parsed.ok) {
      setState({ status: "not-found" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    void (async () => {
      const result = await apiGet<CommunityGetResponse>(
        "/api/community/get",
        { handle },
        { signal: controller.signal },
      );

      if (controller.signal.aborted) return;

      if (result.ok) {
        setState({ status: "ready", data: result.value });
        return;
      }

      if (result.error && typeof result.error === "object" && "status" in result.error) {
        const parsedErr = parseApiError(result.error);
        if (parsedErr.status === 404) {
          setState({ status: "not-found" });
          return;
        }
        setState({ status: "error", message: parsedErr.formError || "Something went wrong." });
        return;
      }

      const parsedErr = parseApiError(result.error);
      setState({ status: "error", message: parsedErr.formError || "Something went wrong." });
    })();

    return () => controller.abort();
  }, [handle]);

  // Activity feed
  const feedParams = React.useMemo(() => ({ handle }), [handle]);
  const { events, loading: feedLoading, loadingMore, hasMore, loadMore } = useActivityFeed({
    endpoint: "/api/community/activity/list",
    params: feedParams,
    filters: { type: activeFilters.type },
  });

  // Client-side search filter
  const filteredEvents = React.useMemo(() => {
    if (!debouncedQ) return events;
    const q = debouncedQ.toLowerCase();
    return events.filter((e) => {
      const actorName = displayName(e.actor).toLowerCase();
      const actorHandle = (e.actor.handle ?? "").toLowerCase();
      const subjectName = e.subject ? displayName(e.subject).toLowerCase() : "";
      const subjectHandle = (e.subject?.handle ?? "").toLowerCase();
      return (
        actorName.includes(q) ||
        actorHandle.includes(q) ||
        subjectName.includes(q) ||
        subjectHandle.includes(q)
      );
    });
  }, [events, debouncedQ]);

  const hasActive = Boolean(filters.q || filters.type);

  if (state.status === "loading" || state.status === "idle") {
    return <ActivitySkeleton />;
  }

  if (state.status === "not-found") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
        <Alert>
          <AlertDescription>We couldn&apos;t find this community.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <div>
          <Button type="button" variant="secondary" onClick={() => setState({ status: "idle" })}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (state.status !== "ready") return null;

  const { community, isAdmin } = state.data;
  const handleLabel = handle;
  const avatarSrc = community.avatarUrl ?? "";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar type="community" src={avatarSrc} name={community.name} className="h-12 w-12" />
        }
        title={community.name}
        description={`@${handleLabel}`}
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            actions={[
              { label: "Filters", active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) },
            ]}
            nav={[
              { label: "Profile", href: communityPath(handleLabel) },
              { label: "Orbit", href: communityOrbitPath(handleLabel) },
              { label: "Members", href: communityMembersPath(handleLabel) },
              { label: "Activity", href: communityActivityPath(handleLabel) },
            ]}
            overflow={isAdmin ? [
              { label: "Applications", href: communityApplicationsPath(handleLabel) },
              { label: "Bans", href: communityBansPath(handleLabel) },
              { label: "Permissions", href: communityPermissionsPath(handleLabel) },
              { label: "Settings", href: communitySettingsPath(handleLabel) },
            ] : undefined}
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
          <CardDescription>Recent events in this community.</CardDescription>
        </CardHeader>
        <CardContent>
          <EventFeed
            events={filteredEvents}
            loading={feedLoading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onLoadMore={loadMore}
            eventTypeConfig={EVENT_TYPE_CONFIG}
            emptyMessage="No activity yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}

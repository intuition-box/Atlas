"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api/client";

// ── Types ──────────────────────────────────────────────────────────

export type ActivityUser = {
  id: string;
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type ActivityEvent = {
  id: string;
  type: string;
  createdAt: string;
  actor: ActivityUser;
  subject: ActivityUser | null;
  metadata: Record<string, unknown> | null;
};

/** Minimal shape any event must satisfy to use this hook. */
type FeedEvent = { id: string };

type FeedResponse<E extends FeedEvent> = {
  events: E[];
  nextCursor: string | null;
};

export type UseActivityFeedOptions = {
  /** API endpoint to fetch events from. */
  endpoint: string;
  /** Static query params (handle, etc.) merged with every request. */
  params: Record<string, string>;
  /** Filter state — non-empty string values are sent as query params. */
  filters?: Record<string, string>;
  /** Page size. Defaults to 50. */
  take?: number;
  /** Whether the feed should fetch. Defaults to true. */
  enabled?: boolean;
};

export type UseActivityFeedReturn<E extends FeedEvent = ActivityEvent> = {
  events: E[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
};

// ── Hook ───────────────────────────────────────────────────────────

/**
 * Generic cursor-based feed hook.
 *
 * Works with any API that returns `{ events, nextCursor }` shape.
 * Used by community activity, user activity, global activity, and more.
 */
export function useActivityFeed<E extends FeedEvent = ActivityEvent>(
  opts: UseActivityFeedOptions,
): UseActivityFeedReturn<E> {
  const { endpoint, params, filters, take = 50, enabled = true } = opts;

  const [events, setEvents] = useState<E[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Stable key for filters + params so we reset on changes
  const filtersKey = JSON.stringify(filters);
  const paramsKey = JSON.stringify(params);

  const load = useCallback(
    async (cursor?: string) => {
      if (!enabled) return;

      const isInitial = !cursor;
      if (isInitial) setLoading(true);
      else setLoadingMore(true);

      const query: Record<string, string> = {
        ...params,
        take: String(take),
      };
      if (cursor) query.cursor = cursor;
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value) query[key] = value;
        }
      }

      const res = await apiGet<FeedResponse<E>>(endpoint, query);

      if (res.ok) {
        setEvents((prev) =>
          isInitial ? res.value.events : [...prev, ...res.value.events],
        );
        setNextCursor(res.value.nextCursor);
      }

      setLoading(false);
      setLoadingMore(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, paramsKey, filtersKey, take, enabled],
  );

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    void load();
  }, [load]);

  const loadMore = useCallback(() => {
    if (nextCursor && !loadingMore) void load(nextCursor);
  }, [nextCursor, loadingMore, load]);

  const hasMore = useMemo(() => !!nextCursor, [nextCursor]);

  return { events, loading, loadingMore, hasMore, loadMore };
}

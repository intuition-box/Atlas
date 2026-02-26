"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ── Skeleton ───────────────────────────────────────────────────────

export interface ListFeedSkeletonProps {
  /** Number of skeleton rows (default: 5). */
  rows?: number;
  /** Custom row renderer. Defaults to the canonical row skeleton. */
  renderRow?: () => ReactNode;
}

function DefaultSkeletonRow() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full shrink-0" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-4 w-16 shrink-0" />
    </div>
  );
}

export function ListFeedSkeleton({ rows = 5, renderRow }: ListFeedSkeletonProps) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}>{renderRow ? renderRow() : <DefaultSkeletonRow />}</div>
      ))}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────

export interface ListFeedEmptyProps {
  message?: string;
  children?: ReactNode;
}

export function ListFeedEmpty({
  message = "No items found.",
  children,
}: ListFeedEmptyProps) {
  return (
    <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
      {children ?? message}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

export interface ListFeedProps<T> {
  /** The items to render. */
  items: T[];
  /** Extract a unique key for each item. */
  keyExtractor: (item: T, index: number) => string;
  /**
   * Render a single row. The row renderer is responsible for the full
   * border/padding styling — `ListFeed` does not wrap the output.
   */
  renderItem: (item: T, index: number) => ReactNode;
  /** Whether the initial data is loading. Shows skeleton when true. */
  loading: boolean;
  /** Whether more data is being appended. */
  loadingMore?: boolean;
  /** Whether there are more items to load. */
  hasMore?: boolean;
  /** Called when "Load more" is clicked. */
  onLoadMore?: () => void;
  /** Custom skeleton to show during initial load. */
  renderSkeleton?: () => ReactNode;
  /** Number of skeleton rows (default: 5). Only used with default skeleton. */
  skeletonRows?: number;
  /** Message for the empty state (default: "No items found."). */
  emptyMessage?: string;
  /** Custom empty state renderer. Overrides emptyMessage. */
  renderEmpty?: () => ReactNode;
  /** Additional className for the outer container. */
  className?: string;
}

export function ListFeed<T>({
  items,
  keyExtractor,
  renderItem,
  loading,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  renderSkeleton,
  skeletonRows,
  emptyMessage,
  renderEmpty,
  className,
}: ListFeedProps<T>) {
  if (loading) {
    return renderSkeleton ? (
      <>{renderSkeleton()}</>
    ) : (
      <ListFeedSkeleton rows={skeletonRows} />
    );
  }

  if (items.length === 0) {
    return renderEmpty ? (
      <>{renderEmpty()}</>
    ) : (
      <ListFeedEmpty message={emptyMessage} />
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {items.map((item, index) => (
        <div key={keyExtractor(item, index)}>{renderItem(item, index)}</div>
      ))}

      {hasMore && onLoadMore && (
        <Button
          type="button"
          variant="secondary"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mx-auto mt-2"
        >
          {loadingMore ? "Loading\u2026" : "Load more"}
        </Button>
      )}
    </div>
  );
}

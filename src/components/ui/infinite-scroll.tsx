"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Spinner } from "./spinner"

type InfiniteScrollProps = {
  /** Called when the sentinel enters the viewport */
  onLoadMore: () => void
  /** Whether there are more items to load */
  hasMore: boolean
  /** Whether currently loading more items */
  isLoading?: boolean
  /** Root margin for intersection observer (default: "200px") */
  rootMargin?: string
  /** Threshold for intersection observer (default: 0) */
  threshold?: number
  /** Custom loading indicator */
  loader?: React.ReactNode
  /** Custom end message when no more items */
  endMessage?: React.ReactNode
  /** Additional className for the container */
  className?: string
  /** Children to render */
  children?: React.ReactNode
}

function InfiniteScroll({
  onLoadMore,
  hasMore,
  isLoading = false,
  rootMargin = "200px",
  threshold = 0,
  loader,
  endMessage,
  className,
  children,
}: InfiniteScrollProps) {
  const sentinelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || isLoading) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry?.isIntersecting && hasMore && !isLoading) {
          onLoadMore()
        }
      },
      { rootMargin, threshold }
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
    }
  }, [hasMore, isLoading, onLoadMore, rootMargin, threshold])

  return (
    <div data-slot="infinite-scroll" className={cn("flex flex-col", className)}>
      {children}

      {/* Sentinel element for intersection observer */}
      <div ref={sentinelRef} data-slot="infinite-scroll-sentinel" aria-hidden="true" />

      {/* Loading indicator */}
      {isLoading && (
        <div
          data-slot="infinite-scroll-loader"
          className="flex items-center justify-center py-6"
          aria-busy="true"
          aria-live="polite"
        >
          {loader ?? <Spinner className="size-6 text-muted-foreground" />}
        </div>
      )}

      {/* End message */}
      {!hasMore && !isLoading && endMessage && (
        <div
          data-slot="infinite-scroll-end"
          className="flex items-center justify-center py-6 text-sm text-muted-foreground"
        >
          {endMessage}
        </div>
      )}
    </div>
  )
}

export { InfiniteScroll }
export type { InfiniteScrollProps }

"use client";

import * as React from "react";

import { FormActions } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

export type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  leadingClassName?: string;
  actions?: React.ReactNode;

  /**
   * When true, the header becomes sticky once it reaches the top of the viewport.
   * Defaults to true.
   */
  sticky?: boolean;

  /**
   * When true, forces the pinned/stuck appearance (border, bg, blur, shadow)
   * regardless of scroll position. Useful for overlay headers on immersive pages.
   */
  pinned?: boolean;

  /**
   * When true (default), wraps `actions` in <FormActions> for consistent spacing.
   */
  actionsAsFormActions?: boolean;

  /**
   * Optional className for the sticky bar wrapper.
   */
  className?: string;

  /**
   * Optional className for the inner content container.
   */
  contentClassName?: string;
};

function PageHeader({
  title,
  description,
  leading,
  leadingClassName,
  actions,
  sticky = true,
  pinned = false,
  actionsAsFormActions = true,
  className,
  contentClassName,
}: PageHeaderProps) {
  const ActionsWrap = actionsAsFormActions ? FormActions : "div";
  const headerRef = React.useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = React.useState(false);

  React.useEffect(() => {
    if (!sticky) return;

    const el = headerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(entry.intersectionRatio < 1),
      { threshold: 1, rootMargin: "-1px 0px 0px 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [sticky]);

  return (
    <div
      ref={headerRef}
      data-slot="page-header"
      data-stuck={isSticky || pinned || undefined}
      className={cn(
        "w-full transition-colors duration-200",
        sticky ? "sticky top-0 z-40 rounded-2xl border border-transparent" : null,
        sticky && (isSticky || pinned) ? "border-border bg-card/80 backdrop-blur-md shadow-lg" : null,
        className,
      )}
    >
      <div
        data-slot="page-header-content"
        data-stuck={pinned}
        className={cn(
          "mx-auto w-full p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
          pinned ? "p-3" : null,
          contentClassName
        )}
      >
        <header
          data-slot="page-header-title"
          className="flex min-w-0 items-center gap-3"
        >
          {leading ? (
            <div
              data-slot="page-header-leading"
              className={cn("shrink-0", leadingClassName)}
            >
              {leading}
            </div>
          ) : null}

          <div data-slot="page-header-text" className="min-w-0 flex flex-col">
            {title ? (
              <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
            ) : (
              <Skeleton className="h-6 w-40" />
            )}
            {description !== undefined ? (
              description ? (
                <p className="text-xs text-muted-foreground">{description}</p>
              ) : (
                <Skeleton className="h-2 w-24 mt-2" />
              )
            ) : null}
          </div>
        </header>

        {actions ? (
          <ActionsWrap
            data-slot="page-header-actions"
            className={cn(
              actionsAsFormActions
                ? "sm:align-center sm:justify-end"
                : "flex flex-wrap items-center justify-center",
            )}
          >
            {actions}
          </ActionsWrap>
        ) : null}
      </div>
    </div>
  );
}

export { PageHeader };
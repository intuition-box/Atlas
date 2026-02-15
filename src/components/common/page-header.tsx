"use client";

import * as React from "react";

import { FormActions } from "@/components/ui/form";
import { cn } from "@/lib/utils";

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
  actionsAsFormActions = true,
  className,
  contentClassName,
}: PageHeaderProps) {
  const ActionsWrap = actionsAsFormActions ? FormActions : "div";
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = React.useState(false);

  React.useEffect(() => {
    if (!sticky) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(!entry.isIntersecting),
      { threshold: 1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sticky]);

  return (
    <>
      {sticky ? <div ref={sentinelRef} className="h-0 w-full" /> : null}
      <div
        data-slot="page-header"
        data-stuck={isSticky || undefined}
        className={cn(
          "w-full transition-colors duration-200",
          sticky ? "sticky top-0 z-40 rounded-2xl" : null,
          sticky && isSticky
            ? "border border-border bg-card/80 backdrop-blur-md"
            : "border border-transparent",
          className,
        )}
      >
      <div
        data-slot="page-header-content"
        className={cn(
          "mx-auto w-full px-4 py-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", 
          contentClassName
        )}
      >
        <header
          data-slot="page-header-title"
          className="flex min-w-0 items-start gap-3"
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
            <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
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
    </>
  );
}

export { PageHeader };
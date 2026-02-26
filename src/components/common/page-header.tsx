"use client";

import * as React from "react";

import { FormActions } from "@/components/ui/form";
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
    <motion.div
      ref={headerRef}
      data-slot="page-header"
      data-stuck={isSticky || pinned || undefined}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "w-full transition-colors duration-200",
        sticky ? "sticky top-0 z-40 rounded-2xl border border-transparent" : null,
        sticky && (isSticky || pinned) ? "border-border bg-card/80 backdrop-blur-md shadow-lg" : null,
        pinned ? "max-w-3xl p-1 absolute top-3 left-1/2 -translate-x-1/2 pointer-events-auto opacity-60 hover:opacity-100" : null,
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
              <p className="text-xs text-muted-foreground">{description}</p>
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
    </motion.div>
  );
}

export { PageHeader };
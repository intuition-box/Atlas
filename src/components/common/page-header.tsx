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

  return (
    <div
      data-slot="page-header"
      className={cn(
        "w-full",
        sticky
          ? "sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
          : null,
        className,
      )}
    >
      <div
        data-slot="page-header-content"
        className={cn("mx-auto w-full max-w-5xl px-4 py-4", contentClassName)}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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

            <div data-slot="page-header-text" className="min-w-0 flex flex-col gap-1">
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
                  ? "sm:justify-end"
                  : "flex flex-wrap items-center justify-start gap-2 sm:justify-end",
              )}
            >
              {actions}
            </ActionsWrap>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { PageHeader };
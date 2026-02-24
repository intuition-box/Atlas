"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu"

// === TYPES ===

/** Standalone action button (e.g., Filters toggle). */
export type ToolbarAction = {
  label: string
  active: boolean
  onClick: () => void
}

/** A single option in a view switch group. Icon-only when `icon` is set. */
export type ViewSwitchOption<T extends string = string> = {
  value: T
  /** Lucide icon component. When provided, renders icon-only with `label` as aria-label. */
  icon?: React.ComponentType<{ className?: string }>
  label: string
}

/** Mutually exclusive view switch (e.g., Cards/List/About). */
export type ViewSwitch<T extends string = string> = {
  value: T
  onChange: (value: T) => void
  options: ViewSwitchOption<T>[]
}

/** Navigation link in the nav group. */
export type NavItem = {
  label: string
  href: string
}

/** Overflow menu link (navigates to a page). */
type OverflowLink = {
  label: string
  href: string
  onClick?: never
  active?: never
}

/** Overflow menu action (toggles state). */
type OverflowAction = {
  label: string
  onClick: () => void
  href?: never
  /** When true, shows a checkmark or highlight. */
  active?: boolean
}

export type OverflowItem = OverflowLink | OverflowAction

export type PageToolbarProps = {
  /** Standalone action buttons (rendered individually, not grouped). */
  actions?: ToolbarAction[]
  /** Mutually exclusive view switch group (icon-only or text). */
  viewSwitch?: ViewSwitch<string>
  /** Navigation links (rendered as a grouped ButtonGroup). */
  nav?: NavItem[]
  /** Overflow menu items (appended to nav group as ⋯ button). */
  overflow?: OverflowItem[]
  className?: string
}

// === COMPONENT ===

function PageToolbar({
  actions,
  viewSwitch,
  nav,
  overflow,
  className,
}: PageToolbarProps) {
  const pathname = usePathname()

  const hasActions = actions && actions.length > 0
  const hasViewSwitch = viewSwitch && viewSwitch.options.length > 0
  const hasNav = (nav && nav.length > 0) || (overflow && overflow.length > 0)

  if (!hasActions && !hasViewSwitch && !hasNav) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Standalone action buttons */}
      {hasActions &&
        actions.map((action) => (
          <Button
            key={action.label}
            type="button"
            variant="outline"
            className={cn(
              action.active
                ? "bg-primary/10 text-primary hover:bg-primary/15"
                : undefined,
            )}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}

      {/* View switch group */}
      {hasViewSwitch && (
        <ButtonGroup>
          {viewSwitch.options.map((opt, i) => {
            const isActive = viewSwitch.value === opt.value
            const Icon = opt.icon
            const isFirst = i === 0
            const isLast = i === viewSwitch.options.length - 1
            return (
              <Button
                key={opt.value}
                type="button"
                variant="outline"
                aria-label={Icon ? opt.label : undefined}
                aria-pressed={isActive}
                className={cn(
                  Icon && "px-2.5",
                  Icon && isFirst && "pl-3.5",
                  Icon && isLast && "pr-3.5",
                  isActive
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : undefined,
                )}
                onClick={() => viewSwitch.onChange(opt.value)}
              >
                {Icon ? <Icon className="size-4" /> : opt.label}
              </Button>
            )
          })}
        </ButtonGroup>
      )}

      {/* Navigation group + overflow */}
      {hasNav && (
        <ButtonGroup>
          {nav?.map((item) => {
            const isActive = pathname === item.href
            return (
              <Button
                key={item.href}
                variant="outline"
                className={cn(
                  isActive
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : undefined,
                )}
                render={<Link href={item.href} />}
              >
                {item.label}
              </Button>
            )
          })}

          {overflow && overflow.length > 0 && (
            <Menu>
              <MenuTrigger
                className={cn(
                  "inline-flex items-center justify-center rounded-4xl border border-border bg-input/30 hover:bg-input/50 text-sm font-medium transition-all cursor-pointer outline-none",
                  // Match button height
                  "h-9 w-9",
                )}
                aria-label="More options"
              >
                <MoreHorizontal className="size-4" />
              </MenuTrigger>
              <MenuContent align="end" sideOffset={4}>
                <MenuGroup>
                  {overflow.map((item, i) => {
                    if (item.href) {
                      return (
                        <MenuItem key={item.href} render={<Link href={item.href} />}>
                          {item.label}
                        </MenuItem>
                      )
                    }

                    return (
                      <MenuItem
                        key={`action-${i}`}
                        onClick={item.onClick}
                        className={cn(item.active ? "text-primary" : undefined)}
                      >
                        {item.label}
                        {item.active && (
                          <span className="ml-auto text-xs text-primary">●</span>
                        )}
                      </MenuItem>
                    )
                  })}
                </MenuGroup>
              </MenuContent>
            </Menu>
          )}
        </ButtonGroup>
      )}
    </div>
  )
}

export { PageToolbar }

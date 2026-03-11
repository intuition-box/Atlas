"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { ExpandableTabs, type TabItem, type Tab } from "@/components/ui/expandable-tab"
import { Separator } from "@/components/ui/separator"
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
  /** Lucide icon component. When provided, renders icon-only with `label` as aria-label. */
  icon?: React.ComponentType<{ className?: string }>
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
  /** Lucide icon. When set on all nav items, renders as expandable icon tabs. */
  icon?: React.ComponentType<{ size?: number; className?: string }>
  /** Active color override (e.g. "text-amber-500" for admin tabs). */
  activeColor?: string
  /** Active background override (e.g. "bg-amber-500/10" for admin tabs). */
  activeBg?: string
}

/** Overflow menu link (navigates to a page). */
type OverflowLink = NavItem & {
  onClick?: never
  active?: never
}

/** Overflow menu action (toggles state). */
type OverflowAction = {
  label: string
  onClick: () => void
  href?: never
  icon?: never
  activeColor?: never
  /** When true, shows a checkmark or highlight. */
  active?: boolean
}

export type OverflowItem = OverflowLink | OverflowAction

export type PageToolbarProps = {
  /** Standalone action buttons (rendered individually, not grouped). */
  actions?: ToolbarAction[]
  /** Mutually exclusive view switch group (icon-only or text). */
  viewSwitch?: ViewSwitch<string>
  /** Navigation links (rendered as expandable tabs when icons are present, or ButtonGroup fallback). */
  nav?: NavItem[]
  /** Overflow menu items. When items have icons, rendered as a second tab group with separator. */
  overflow?: OverflowItem[]
  className?: string
}

// === HELPERS ===

/** Check whether all nav items in an array carry icons (opt-in to expandable tabs). */
function allHaveIcons(items: NavItem[]): boolean {
  return items.length > 0 && items.every((item) => item.icon)
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

  // Determine rendering mode: expandable tabs (icons) vs legacy ButtonGroup
  const navHasIcons = nav ? allHaveIcons(nav) : false
  const viewSwitchHasIcons = hasViewSwitch && viewSwitch.options.every((o) => o.icon)
  const overflowLinks = overflow?.filter((o): o is OverflowLink => !!o.href) ?? []
  const overflowHasIcons = overflowLinks.length > 0 && overflowLinks.every((o) => o.icon)

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Standalone action buttons (left-most) */}
      <AnimatePresence>
        {hasActions &&
          actions.map((action) => {
            const Icon = action.icon
            return (
              <motion.div
                key={action.label}
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(4px)" }}
                transition={{ duration: 0.2 }}
              >
                <Button
                  type="button"
                  variant="outline"
                  aria-label={Icon ? action.label : undefined}
                  className={cn(
                    Icon && "px-2.5",
                    action.active
                      ? "bg-primary/10 text-primary hover:bg-primary/15"
                      : "text-muted-foreground",
                  )}
                  onClick={action.onClick}
                >
                  {Icon ? <Icon className="size-4" /> : action.label}
                </Button>
              </motion.div>
            )
          })}
      </AnimatePresence>

      {/* View switch group — expandable icon tabs when icons are present */}
      <AnimatePresence>
        {hasViewSwitch && (
          <motion.div
            key="view-switch"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.2 }}
          >
            {viewSwitchHasIcons ? (
              <ExpandableViewSwitch viewSwitch={viewSwitch} />
            ) : (
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
                          : "text-muted-foreground",
                      )}
                      onClick={() => viewSwitch.onChange(opt.value)}
                    >
                      {Icon ? <Icon className="size-4" /> : opt.label}
                    </Button>
                  )
                })}
              </ButtonGroup>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Expandable icon tabs (new path) ── */}
      {hasNav && navHasIcons && (
        <ExpandableIconNav
          nav={nav!}
          overflow={overflowHasIcons ? overflowLinks : undefined}
          pathname={pathname}
        />
      )}

      {/* ── Legacy ButtonGroup fallback (no icons) ── */}
      {hasNav && !navHasIcons && (
        <LegacyButtonGroupNav
          nav={nav}
          overflow={overflow}
          pathname={pathname}
        />
      )}
    </div>
  )
}

// === EXPANDABLE VIEW SWITCH ===

/** Renders a ViewSwitch as expandable icon tabs (when all options have icons). */
function ExpandableViewSwitch({ viewSwitch }: { viewSwitch: ViewSwitch<string> }) {
  const activeIndex = viewSwitch.options.findIndex((o) => o.value === viewSwitch.value)

  const tabs: TabItem[] = viewSwitch.options.map((opt) => ({
    title: opt.label,
    icon: opt.icon!,
  }))

  return (
    <ExpandableTabs
      tabs={tabs}
      activeIndex={activeIndex >= 0 ? activeIndex : null}
      onChange={(index) => {
        if (index !== null && viewSwitch.options[index]) {
          viewSwitch.onChange(viewSwitch.options[index].value)
        }
      }}
    />
  )
}

// === EXPANDABLE ICON NAV ===

/** Delay (ms) between triggering the tab animation and navigating. */
const NAV_ANIMATION_DELAY = 250

function ExpandableIconNav({
  nav,
  overflow,
  pathname,
}: {
  nav: NavItem[]
  overflow?: NavItem[]
  pathname: string
}) {
  const router = useRouter()

  // Pre-navigation animation: when a tab is clicked, we briefly set
  // `pendingIndex` so the old tab collapses / new tab expands within
  // the current mounted component, then navigate after a short delay.
  const [pendingIndex, setPendingIndex] = React.useState<number | null>(null)
  const navTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up on unmount
  React.useEffect(() => {
    return () => {
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current)
    }
  }, [])

  // Reset pending state when the pathname actually changes (navigation completed)
  React.useEffect(() => {
    setPendingIndex(null)
    if (navTimeoutRef.current) {
      clearTimeout(navTimeoutRef.current)
      navTimeoutRef.current = null
    }
  }, [pathname])

  // Build TabItem array and a parallel href map (skipping separators)
  const tabItems: TabItem[] = []
  const hrefMap: string[] = []

  for (const item of nav) {
    tabItems.push({
      title: item.label,
      icon: item.icon!,
      activeColor: item.activeColor,
      activeBg: item.activeBg,
    })
    hrefMap.push(item.href)
  }

  if (overflow && overflow.length > 0) {
    tabItems.push({ type: "separator" })
    for (const item of overflow) {
      tabItems.push({
        title: item.label,
        icon: item.icon!,
        activeColor: item.activeColor,
        activeBg: item.activeBg,
      })
      hrefMap.push(item.href)
    }
  }

  // Compute active index from pathname
  const activeHrefIdx = hrefMap.findIndex((href) => pathname === href)

  // Map href index → tab index (accounting for separator offsets)
  let activeTabIdx: number | null = null
  if (activeHrefIdx >= 0) {
    let hrefCounter = 0
    for (let i = 0; i < tabItems.length; i++) {
      if (tabItems[i].type === "separator") continue
      if (hrefCounter === activeHrefIdx) {
        activeTabIdx = i
        break
      }
      hrefCounter++
    }
  }

  // Effective active: pending animation takes priority over pathname
  const effectiveActive = pendingIndex ?? activeTabIdx

  // Build reverse map: tab index → href index
  const tabIdxToHrefIdx = React.useMemo(() => {
    const map = new Map<number, number>()
    let hrefIdx = 0
    for (let i = 0; i < tabItems.length; i++) {
      if (tabItems[i].type === "separator") continue
      map.set(i, hrefIdx)
      hrefIdx++
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabItems.length, nav.length, overflow?.length])

  return (
    <ExpandableTabs
      tabs={tabItems}
      activeIndex={effectiveActive}
      renderTab={({ children, index }) => {
        const hrefIdx = tabIdxToHrefIdx.get(index)
        if (hrefIdx === undefined) return <>{children}</>
        const href = hrefMap[hrefIdx]
        return (
          <Link
            key={href}
            href={href}
            onClick={(e) => {
              // Don't intercept modified clicks (ctrl/cmd/shift/middle-click)
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              // Don't intercept if already on this tab
              if (effectiveActive === index) return

              e.preventDefault()

              // Cancel any pending navigation
              if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current)

              // Trigger tab animation immediately
              setPendingIndex(index)

              // Navigate after animation delay
              navTimeoutRef.current = setTimeout(() => {
                router.push(href)
                navTimeoutRef.current = null
              }, NAV_ANIMATION_DELAY)
            }}
          >
            {children}
          </Link>
        )
      }}
    />
  )
}

// === LEGACY BUTTON GROUP NAV ===

function LegacyButtonGroupNav({
  nav,
  overflow,
  pathname,
}: {
  nav?: NavItem[]
  overflow?: OverflowItem[]
  pathname: string
}) {
  return (
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

      {overflow && overflow.length > 0 && (() => {
        const overflowActive = overflow.some((item) => item.href && pathname === item.href)
        return (
        <Menu>
          <MenuTrigger
            className={cn(
              "inline-flex items-center justify-center rounded-4xl border border-border text-sm font-medium transition-all cursor-pointer outline-none",
              "h-9 w-9",
              overflowActive
                ? "bg-primary/10 text-primary hover:bg-primary/15"
                : "bg-input/30 hover:bg-input/50",
            )}
            aria-label="More options"
          >
            <MoreHorizontal className="size-4" />
          </MenuTrigger>
          <MenuContent align="end" sideOffset={4}>
            <MenuGroup>
              {overflow.map((item, i) => {
                if (item.href) {
                  const isLinkActive = pathname === item.href
                  return (
                    <MenuItem
                      key={item.href}
                      render={<Link href={item.href} />}
                      className={cn(isLinkActive ? "text-primary" : undefined)}
                    >
                      {item.label}
                      {isLinkActive && (
                        <span className="ml-auto text-xs text-primary">●</span>
                      )}
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
        )
      })()}
    </ButtonGroup>
  )
}

export { PageToolbar }

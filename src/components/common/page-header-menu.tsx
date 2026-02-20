"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface NavMenuLink {
  type?: "link"
  label: string
  href: string
}

interface NavMenuSeparator {
  type: "separator"
}

type NavMenuItem = NavMenuLink | NavMenuSeparator

interface PageHeaderMenuProps {
  /** Navigation links and separators. The first link item is used as the trigger label. */
  items: NavMenuItem[]
  className?: string
}

function isLink(item: NavMenuItem): item is NavMenuLink {
  return item.type !== "separator"
}

/**
 * Select-based navigation for page headers.
 *
 * The trigger displays the first link item's label ("Profile").
 * Hovering opens the dropdown; clicking the trigger navigates to the first item's href.
 * Selecting any other item navigates to that item's href.
 */
export function PageHeaderMenu({ items, className }: PageHeaderMenuProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const hoveringRef = React.useRef(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  const linkItems = items.filter(isLink)
  if (linkItems.length === 0) return null

  function handleMouseEnter() {
    hoveringRef.current = true
    setOpen(true)
  }

  function handleMouseLeave() {
    hoveringRef.current = false
    setOpen(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setOpen(false)
    }
  }

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Select<string>
        open={open}
        onOpenChange={handleOpenChange}
        onValueChange={(href) => {
          if (href) router.push(href)
        }}
      >
        <SelectTrigger
          ref={triggerRef}
          className={cn(
            "!border-transparent !bg-primary !text-primary-foreground font-medium hover:!bg-primary/80 [&_[data-slot=select-icon]]:hidden focus:!ring-0",
            className
          )}
          onClick={(e) => {
            e.preventDefault()
          }}
        >
          <SelectValue>{() => linkItems[0].label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item, i) => {
              if (item.type === "separator") {
                return <SelectSeparator key={`sep-${i}`} />
              }
              return (
                <SelectItem key={item.href} value={item.href} className="cursor-pointer [&_svg]:hidden [&>span:last-child]:hidden">
                  {item.label}
                </SelectItem>
              )
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

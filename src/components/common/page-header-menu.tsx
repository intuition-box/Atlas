"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface NavMenuItem {
  label: string
  href: string
}

interface PageHeaderNavMenuProps {
  /** Navigation links. The first item is selected by default. */
  items: NavMenuItem[]
  className?: string
}

/**
 * Select-based navigation for page headers.
 *
 * The trigger displays the first item's label ("Profile").
 * Hovering opens the dropdown; clicking the trigger navigates to the first item's href.
 * Selecting any other item navigates to that item's href.
 */
export function PageHeaderNavMenu({ items, className }: PageHeaderNavMenuProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const hoveringRef = React.useRef(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  if (items.length === 0) return null

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
            "!border-transparent !bg-primary !text-primary-foreground hover:!bg-primary/80 [&_[data-slot=select-icon]]:hidden focus:!ring-0",
            className
          )}
          onClick={(e) => {
            e.preventDefault()
          }}
        >
          <SelectValue>{() => items[0].label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.href} value={item.href} className="cursor-pointer [&_svg]:hidden [&>span:last-child]:hidden">
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

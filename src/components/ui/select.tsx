"use client"

import * as React from "react"

import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"

type SelectProps<Value, Multiple extends boolean | undefined = false> =
  SelectPrimitive.Root.Props<Value, Multiple>

type SelectGroupProps = React.ComponentProps<typeof SelectPrimitive.Group>
type SelectValueProps = React.ComponentProps<typeof SelectPrimitive.Value>
type SelectTriggerBaseProps = React.ComponentProps<typeof SelectPrimitive.Trigger>
type SelectPortalProps = React.ComponentProps<typeof SelectPrimitive.Portal>
type SelectPositionerProps = React.ComponentProps<typeof SelectPrimitive.Positioner>
type SelectPopupProps = React.ComponentProps<typeof SelectPrimitive.Popup>
type SelectListProps = React.ComponentProps<typeof SelectPrimitive.List>
type SelectLabelProps = React.ComponentProps<typeof SelectPrimitive.GroupLabel>
type SelectItemProps = React.ComponentProps<typeof SelectPrimitive.Item>
type SelectSeparatorProps = React.ComponentProps<typeof SelectPrimitive.Separator>

type SelectTriggerProps = SelectTriggerBaseProps & {
  size?: "sm" | "default"
}

type SelectContentProps = SelectPopupProps &
  Pick<
    SelectPositionerProps,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >

function Select<Value, Multiple extends boolean | undefined = false>({
  ...props
}: SelectProps<Value, Multiple>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectPortal({ ...props }: SelectPortalProps) {
  return <SelectPrimitive.Portal data-slot="select-portal" {...props} />
}

function SelectPositioner({ className, ...props }: SelectPositionerProps) {
  return (
    <SelectPrimitive.Positioner
      data-slot="select-positioner"
      className={className}
      {...props}
    />
  )
}

function SelectList({ className, ...props }: SelectListProps) {
  return (
    <SelectPrimitive.List
      data-slot="select-list"
      className={className}
      {...props}
    />
  )
}

function SelectGroup({ className, ...props }: SelectGroupProps) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectValueProps) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 gap-1.5 rounded-4xl border px-3 py-2 text-sm transition-colors focus-visible:ring-[3px] aria-invalid:ring-[3px] data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:flex *:data-[slot=select-value]:gap-1.5 [&_svg:not([class*='size-'])]:size-4 flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        data-slot="select-icon"
        render={
          <HugeiconsIcon
            icon={UnfoldMoreIcon}
            strokeWidth={2}
            className="text-muted-foreground size-4 pointer-events-none"
          />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectContentProps) {
  return (
    <SelectPortal>
      <SelectPositioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 min-w-36 rounded-2xl shadow-2xl ring-1 duration-100 relative isolate z-50 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectList>{children}</SelectList>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPositioner>
    </SelectPortal>
  )
}

function SelectLabel({ className, ...props }: SelectLabelProps) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("text-muted-foreground px-3 py-2.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent/10 focus:text-primary not-data-[variant=destructive]:focus:**:text-primary gap-2.5 rounded-xl py-2 pr-8 pl-3 text-sm [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2 relative flex w-full cursor-default items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 gap-2 shrink-0 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border/50 -mx-1 my-1 h-px pointer-events-none", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4 top-0 w-full",
        className,
      )}
      {...props}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4 bottom-0 w-full",
        className,
      )}
      {...props}
    >
      <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectList,
  SelectPortal,
  SelectPositioner,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

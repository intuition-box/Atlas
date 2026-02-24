"use client"

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

type ContextMenuProps = React.ComponentProps<typeof ContextMenuPrimitive.Root>
type ContextMenuPortalProps = React.ComponentProps<typeof ContextMenuPrimitive.Portal>
type ContextMenuTriggerProps = React.ComponentProps<typeof ContextMenuPrimitive.Trigger>

type ContextMenuContentProps = React.ComponentProps<typeof ContextMenuPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof ContextMenuPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >

type ContextMenuGroupProps = React.ComponentProps<typeof ContextMenuPrimitive.Group>

type ContextMenuLabelProps = React.ComponentProps<typeof ContextMenuPrimitive.GroupLabel> & {
  inset?: boolean
}

type ContextMenuItemProps = React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}

type ContextMenuSubProps = React.ComponentProps<typeof ContextMenuPrimitive.SubmenuRoot>

type ContextMenuSubTriggerProps = React.ComponentProps<typeof ContextMenuPrimitive.SubmenuTrigger> & {
  inset?: boolean
}

type ContextMenuCheckboxItemProps = React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>

type ContextMenuRadioGroupProps = React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>

type ContextMenuRadioItemProps = React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>

type ContextMenuSeparatorProps = React.ComponentProps<typeof ContextMenuPrimitive.Separator>

type ContextMenuShortcutProps = React.ComponentProps<"span">

function ContextMenu(props: ContextMenuProps) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuPortal(props: ContextMenuPortalProps) {
  return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
}

function ContextMenuTrigger({ className, ...props }: ContextMenuTriggerProps) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  align = "start",
  alignOffset = 4,
  side = "right",
  sideOffset = 0,
  ...props
}: ContextMenuContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "bg-popover text-popover-foreground min-w-48 rounded-2xl p-1 shadow-2xl ring-1 ring-foreground/5",
            "max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto outline-none",
            "data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0",
            "data-open:zoom-in-95 data-closed:zoom-out-95 duration-100",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuGroup(props: ContextMenuGroupProps) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
}

function ContextMenuLabel({ className, inset, ...props }: ContextMenuLabelProps) {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn("text-muted-foreground px-3 py-2.5 text-xs data-[inset]:pl-8", className)}
      {...props}
    />
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ContextMenuItemProps) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item relative flex cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm",
        "outline-hidden select-none",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "focus:bg-accent/10 focus:text-primary",
        "data-[inset]:pl-8",
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "focus:*:[svg]:text-primary",
        "data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:text-destructive",
        "data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20",
        "data-[variant=destructive]:focus:text-destructive",
        className,
      )}
      {...props}
    />
  )
}

function ContextMenuSub(props: ContextMenuSubProps) {
  return <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
}

function ContextMenuSubTrigger({ className, inset, children, ...props }: ContextMenuSubTriggerProps) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center rounded-xl px-3 py-2 text-sm",
        "outline-hidden select-none",
        "focus:bg-accent/10 focus:text-primary",
        "data-open:bg-accent/10 data-open:text-primary",
        "data-[inset]:pl-8",
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  )
}

function ContextMenuSubContent(props: React.ComponentProps<typeof ContextMenuContent>) {
  return (
    <ContextMenuContent
      data-slot="context-menu-sub-content"
      className="shadow-lg"
      side="right"
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({ className, children, checked, ...props }: ContextMenuCheckboxItemProps) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-xl py-2 pr-8 pl-3 text-sm",
        "outline-hidden select-none",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "focus:bg-accent/10 focus:text-primary",
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute right-2 pointer-events-none">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioGroup(props: ContextMenuRadioGroupProps) {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />
}

function ContextMenuRadioItem({ className, children, ...props }: ContextMenuRadioItemProps) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm",
        "outline-hidden select-none",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "focus:bg-accent/10 focus:text-primary",
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 pointer-events-none">
        <ContextMenuPrimitive.RadioItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuSeparator({ className, ...props }: ContextMenuSeparatorProps) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("bg-border/50 -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({ className, ...props }: ContextMenuShortcutProps) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "text-muted-foreground group-focus/context-menu-item:text-primary ml-auto text-xs tracking-widest",
        className,
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
}
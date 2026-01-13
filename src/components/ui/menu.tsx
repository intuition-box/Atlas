"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

type MenuProps = React.ComponentProps<typeof MenuPrimitive.Root>

type MenuPortalProps = React.ComponentProps<typeof MenuPrimitive.Portal>

type MenuTriggerProps = React.ComponentProps<typeof MenuPrimitive.Trigger>

type MenuContentProps = React.ComponentProps<typeof MenuPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof MenuPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >

type MenuGroupProps = React.ComponentProps<typeof MenuPrimitive.Group>

type MenuLabelProps = React.ComponentProps<typeof MenuPrimitive.GroupLabel> & {
  inset?: boolean
}

type MenuItemProps = React.ComponentProps<typeof MenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}

type MenuSubProps = React.ComponentProps<typeof MenuPrimitive.SubmenuRoot>

type MenuSubTriggerProps = React.ComponentProps<typeof MenuPrimitive.SubmenuTrigger> & {
  inset?: boolean
}

type MenuSubContentProps = MenuContentProps

type MenuCheckboxItemProps = React.ComponentProps<typeof MenuPrimitive.CheckboxItem>

type MenuRadioGroupProps = React.ComponentProps<typeof MenuPrimitive.RadioGroup>

type MenuRadioItemProps = React.ComponentProps<typeof MenuPrimitive.RadioItem>

type MenuSeparatorProps = React.ComponentProps<typeof MenuPrimitive.Separator>

type MenuShortcutProps = React.ComponentProps<"span">

function Menu(props: MenuProps) {
  return <MenuPrimitive.Root data-slot="menu" {...props} />
}

function MenuPortal(props: MenuPortalProps) {
  return <MenuPrimitive.Portal data-slot="menu-portal" {...props} />
}

function MenuTrigger(props: MenuTriggerProps) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />
}

function MenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuContentProps) {
  return (
    <MenuPortal>
      <MenuPrimitive.Positioner
        data-slot="menu-positioner"
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/5 z-50 min-w-48 rounded-2xl p-1 shadow-2xl ring-1 outline-none duration-100 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:overflow-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPortal>
  )
}

function MenuGroup(props: MenuGroupProps) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />
}

function MenuLabel({ className, inset, ...props }: MenuLabelProps) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menu-label"
      data-inset={inset}
      className={cn("text-muted-foreground px-3 py-2.5 text-xs data-[inset]:pl-8", className)}
      {...props}
    />
  )
}

function MenuItem({ className, inset, variant = "default", ...props }: MenuItemProps) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/menu-item relative flex cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-[inset]:pl-8 focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 not-data-[variant=destructive]:focus:**:text-accent-foreground",
        className,
      )}
      {...props}
    />
  )
}

function MenuSub(props: MenuSubProps) {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />
}

function MenuSubTrigger({ className, inset, children, ...props }: MenuSubTriggerProps) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-xl px-3 py-2 text-sm outline-hidden select-none data-[inset]:pl-8 focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function MenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: MenuSubContentProps) {
  return (
    <MenuContent
      data-slot="menu-sub-content"
      className={cn("min-w-36 rounded-2xl p-1 shadow-2xl ring-1 duration-100 w-auto", className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function MenuCheckboxItem({ className, children, checked, ...props }: MenuCheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menu-checkbox-item"
      className={cn(
        "group/menu-item relative flex cursor-default items-center gap-2.5 rounded-xl py-2 pr-8 pl-3 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        data-slot="menu-checkbox-item-indicator"
        className="pointer-events-none absolute right-2 flex items-center justify-center"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function MenuRadioGroup(props: MenuRadioGroupProps) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />
}

function MenuRadioItem({ className, children, ...props }: MenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menu-radio-item"
      className={cn(
        "group/menu-item relative flex cursor-default items-center gap-2.5 rounded-xl py-2 pr-8 pl-3 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      <span
        data-slot="menu-radio-item-indicator"
        className="pointer-events-none absolute right-2 flex items-center justify-center"
      >
        <MenuPrimitive.RadioItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function MenuSeparator({ className, ...props }: MenuSeparatorProps) {
  return (
    <MenuPrimitive.Separator
      data-slot="menu-separator"
      className={cn("bg-border/50 -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function MenuShortcut({ className, ...props }: MenuShortcutProps) {
  return (
    <span
      data-slot="menu-shortcut"
      className={cn(
        "text-muted-foreground group-focus/menu-item:text-accent-foreground ml-auto text-xs tracking-widest",
        className,
      )}
      {...props}
    />
  )
}

export {
  Menu,
  MenuPortal,
  MenuTrigger,
  MenuContent,
  MenuGroup,
  MenuLabel,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubTrigger,
  MenuSubContent,
}

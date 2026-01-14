"use client"

import * as React from "react"
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar"

import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuPortal,
  MenuRadioGroup,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  MenuCheckboxItem,
  MenuRadioItem,
} from "@/components/ui/menu"

import { cn } from "@/lib/utils"

function Menubar({ className, ...props }: React.ComponentProps<typeof MenubarPrimitive>) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      className={cn("bg-background h-9 rounded-2xl border p-1 flex items-center", className)}
      {...props}
    />
  )
}

function MenubarMenu({ ...props }: React.ComponentProps<typeof Menu>) {
  return <Menu data-slot="menubar-menu" {...props} />
}

function MenubarGroup({
  ...props
}: React.ComponentProps<typeof MenuGroup>) {
  return <MenuGroup data-slot="menubar-group" {...props} />
}

function MenubarPortal({
  ...props
}: React.ComponentProps<typeof MenuPortal>) {
  return <MenuPortal data-slot="menubar-portal" {...props} />
}

function MenubarTrigger({ ...props }: React.ComponentProps<typeof MenuTrigger>) {
  return <MenuTrigger data-slot="menubar-trigger" {...props} />
}

function MenubarContent({
  align = "start",
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof MenuContent>) {
  return (
    <MenuContent
      data-slot="menubar-content"
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function MenubarItem({ ...props }: React.ComponentProps<typeof MenuItem>) {
  return <MenuItem data-slot="menubar-item" {...props} />
}

function MenubarCheckboxItem({ ...props }: React.ComponentProps<typeof MenuCheckboxItem>) {
  return <MenuCheckboxItem data-slot="menubar-checkbox-item" {...props} />
}

function MenubarRadioGroup({
  ...props
}: React.ComponentProps<typeof MenuRadioGroup>) {
  return <MenuRadioGroup data-slot="menubar-radio-group" {...props} />
}

function MenubarRadioItem({ ...props }: React.ComponentProps<typeof MenuRadioItem>) {
  return <MenuRadioItem data-slot="menubar-radio-item" {...props} />
}

function MenubarLabel({ ...props }: React.ComponentProps<typeof MenuLabel>) {
  return <MenuLabel data-slot="menubar-label" {...props} />
}

function MenubarSeparator({ ...props }: React.ComponentProps<typeof MenuSeparator>) {
  return <MenuSeparator data-slot="menubar-separator" {...props} />
}

function MenubarShortcut({ ...props }: React.ComponentProps<typeof MenuShortcut>) {
  return <MenuShortcut data-slot="menubar-shortcut" {...props} />
}

function MenubarSub({
  ...props
}: React.ComponentProps<typeof MenuSub>) {
  return <MenuSub data-slot="menubar-sub" {...props} />
}

function MenubarSubTrigger({ ...props }: React.ComponentProps<typeof MenuSubTrigger>) {
  return <MenuSubTrigger data-slot="menubar-sub-trigger" {...props} />
}

function MenubarSubContent({ ...props }: React.ComponentProps<typeof MenuSubContent>) {
  return <MenuSubContent data-slot="menubar-sub-content" {...props} />
}

export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
}
"use client"

import * as React from "react"

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"

import { cn } from "@/lib/utils"

type PreviewCardProps = React.ComponentProps<typeof PreviewCardPrimitive.Root>
type PreviewCardTriggerProps = React.ComponentProps<typeof PreviewCardPrimitive.Trigger>
type PreviewCardPortalProps = React.ComponentProps<typeof PreviewCardPrimitive.Portal>
type PreviewCardPositionerProps = React.ComponentProps<typeof PreviewCardPrimitive.Positioner>
type PreviewCardPopupProps = React.ComponentProps<typeof PreviewCardPrimitive.Popup>

type PreviewCardContentProps = PreviewCardPopupProps &
  Pick<
    PreviewCardPositionerProps,
    "align" | "alignOffset" | "side" | "sideOffset"
  >

function PreviewCard({ ...props }: PreviewCardProps) {
  return <PreviewCardPrimitive.Root data-slot="preview-card" {...props} />
}

function PreviewCardTrigger({ ...props }: PreviewCardTriggerProps) {
  return (
    <PreviewCardPrimitive.Trigger
      data-slot="preview-card-trigger"
      {...props}
    />
  )
}

function PreviewCardPortal({ ...props }: PreviewCardPortalProps) {
  return <PreviewCardPrimitive.Portal data-slot="preview-card-portal" {...props} />
}

function PreviewCardPositioner({
  className,
  ...props
}: PreviewCardPositionerProps) {
  return (
    <PreviewCardPrimitive.Positioner
      data-slot="preview-card-positioner"
      className={className}
      {...props}
    />
  )
}

function PreviewCardContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 4,
  ...props
}: PreviewCardContentProps) {
  return (
    <PreviewCardPortal>
      <PreviewCardPositioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          data-slot="preview-card-content"
          className={cn(
            "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 bg-popover text-popover-foreground w-72 rounded-2xl p-4 text-sm shadow-2xl ring-1 duration-100 z-50 origin-(--transform-origin) outline-hidden",
            className,
          )}
          {...props}
        />
      </PreviewCardPositioner>
    </PreviewCardPortal>
  )
}

export { PreviewCard, PreviewCardTrigger, PreviewCardContent }

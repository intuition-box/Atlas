"use client"

import * as React from "react"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

type CollapsibleProps = React.ComponentProps<typeof CollapsiblePrimitive.Root>
type CollapsibleTriggerProps = React.ComponentProps<typeof CollapsiblePrimitive.Trigger>
type CollapsibleContentProps = React.ComponentProps<typeof CollapsiblePrimitive.Panel>

function Collapsible({ ...props }: CollapsibleProps) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsibleTriggerProps) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

function CollapsibleContent({ ...props }: CollapsibleContentProps) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }

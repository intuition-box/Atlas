"use client"

import * as React from "react"

import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import { cn } from "@/lib/utils"
import { Radio } from "@/components/ui/radio"

type RadioGroupProps = React.ComponentProps<typeof RadioGroupPrimitive>
type RadioGroupItemProps = React.ComponentProps<typeof Radio>

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid gap-3 w-full", className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: RadioGroupItemProps) {
  return (
    <Radio
      data-slot="radio-group-item"
      className={cn(className)}
      {...props}
    />
  )
}

export { RadioGroup, RadioGroupItem }

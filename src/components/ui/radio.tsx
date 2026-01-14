"use client"

import * as React from "react"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"

import { cn } from "@/lib/utils"

type RadioProps = React.ComponentPropsWithoutRef<typeof RadioPrimitive.Root>
type RadioIndicatorProps = React.ComponentProps<typeof RadioPrimitive.Indicator>

const Radio = React.forwardRef<
  React.ComponentRef<typeof RadioPrimitive.Root>,
  RadioProps
>(function Radio({ className, ...props }, ref) {
  return (
    <RadioPrimitive.Root
      ref={ref}
      data-slot="radio"
      className={cn(
        "border-input text-primary dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 data-checked:bg-primary data-checked:border-primary inline-flex size-4 rounded-full transition-color focus-visible:ring-[3px] aria-invalid:ring-[3px] group/radio peer relative aspect-square shrink-0 border outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      {...props}
    >
      <RadioIndicator />
    </RadioPrimitive.Root>
  )
})

Radio.displayName = "Radio"

function RadioIndicator({ className, ...props }: RadioIndicatorProps) {
  return (
    <RadioPrimitive.Indicator
      data-slot="radio-indicator"
      className={cn(
        "group-aria-invalid/radio:text-destructive text-primary-foreground flex items-center justify-center data-[unchecked]:opacity-0",
        "after:block after:size-2 after:rounded-full after:bg-current",
        className,
      )}
      {...props}
    />
  )
}

export { Radio, RadioIndicator }

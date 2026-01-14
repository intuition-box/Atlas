import * as React from "react"

import { cn } from "@/lib/utils"

type TextareaProps = Omit<React.ComponentProps<"textarea">, "onChange"> & {
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
  onValueChange?: (value: string) => void
}

function Textarea({ className, onChange, onValueChange, ...props }: TextareaProps) {
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange?.(e)
    onValueChange?.(e.target.value)
  }

  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 resize-none rounded-xl border px-3 py-3 text-base transition-colors focus-visible:ring-[3px] aria-invalid:ring-[3px] md:text-sm placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onChange={handleChange}
      {...props}
    />
  )
}

export { Textarea }

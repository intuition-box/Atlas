import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "h-5 gap-1 rounded-4xl border px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! inline-flex items-center justify-center w-fit whitespace-nowrap shrink-0 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-colors overflow-hidden group/badge",
  {
    variants: {
      variant: {
        default: "bg-input/30 text-primary border-primary/20 [a]:hover:bg-input/50",
        solid: "bg-primary text-primary-foreground border-transparent [a]:hover:bg-primary/80",
        secondary: "bg-input/30 text-secondary-foreground border-border [a]:hover:bg-input/50",
        positive: "bg-input/30 text-emerald-500 border-emerald-500/20 [a]:hover:bg-input/50",
        info: "bg-input/30 text-amber-600 border-amber-500/20 [a]:hover:bg-input/50",
        destructive: "bg-input/30 text-destructive border-destructive/20 [a]:hover:bg-input/50 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline: "bg-input/30 text-foreground border-border [a]:hover:bg-input/50",
        ghost: "border-transparent hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ className, variant })),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }

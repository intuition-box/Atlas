"use client"

import * as React from "react"
import { Field as FieldPrimitive } from "@base-ui/react/field"

import { cn } from "@/lib/utils"

export type FieldProps = React.ComponentProps<typeof FieldPrimitive.Root>
export type FieldLabelProps = React.ComponentProps<typeof FieldPrimitive.Label>
export type FieldDescriptionProps = React.ComponentProps<typeof FieldPrimitive.Description>
export type FieldItemProps = React.ComponentProps<typeof FieldPrimitive.Item>
export type FieldErrorProps = React.ComponentProps<typeof FieldPrimitive.Error>
export type FieldValidityProps = React.ComponentProps<typeof FieldPrimitive.Validity>

// `ref` is important for React Hook Form / focus management, so we forward it only on the control.
export type FieldControlProps = React.ComponentPropsWithoutRef<typeof FieldPrimitive.Control>

export function Field({ className, ...props }: FieldProps) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      className={cn("grid gap-2 data-[invalid]:text-destructive", className)}
      {...props}
    />
  )
}

export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn(
        "text-sm font-medium leading-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-70",
        className,
      )}
      {...props}
    />
  )
}

export const FieldControl = React.forwardRef<
  React.ComponentRef<typeof FieldPrimitive.Control>,
  FieldControlProps
>(({ className, ...props }, ref) => (
  <FieldPrimitive.Control
    ref={ref}
    data-slot="field-control"
    className={cn(
      "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  />
))
FieldControl.displayName = "FieldControl"

export function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export function FieldItem({ className, ...props }: FieldItemProps) {
  return (
    <FieldPrimitive.Item
      data-slot="field-item"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

export function FieldError({ className, ...props }: FieldErrorProps) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      className={cn("text-sm font-medium text-destructive", className)}
      {...props}
    />
  )
}

// Base UI's Validity does not accept `className`/`ref` (and we don't need to style it yet),
// so we export it as-is.
export const FieldValidity = FieldPrimitive.Validity

export { FieldPrimitive }
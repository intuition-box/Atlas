"use client"

import * as React from "react"

import { Toast as ToastPrimitive } from "@base-ui/react/toast"

import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
  MultiplicationSignCircleIcon,
} from "@hugeicons/core-free-icons"

type ToastProviderProps = React.ComponentProps<typeof ToastPrimitive.Provider>
type ToastPortalProps = React.ComponentProps<typeof ToastPrimitive.Portal>
type ToastViewportProps = React.ComponentProps<typeof ToastPrimitive.Viewport>
type ToastPositionerProps = React.ComponentProps<typeof ToastPrimitive.Positioner>
type ToastRootProps = React.ComponentProps<typeof ToastPrimitive.Root>
type ToastContentProps = React.ComponentProps<typeof ToastPrimitive.Content>
type ToastTitleProps = React.ComponentProps<typeof ToastPrimitive.Title>
type ToastDescriptionProps = React.ComponentProps<typeof ToastPrimitive.Description>
type ToastActionProps = React.ComponentProps<typeof ToastPrimitive.Action>
type ToastCloseProps = React.ComponentProps<typeof ToastPrimitive.Close>
type ToastArrowProps = React.ComponentProps<typeof ToastPrimitive.Arrow>

type ToasterProps = {
  className?: string
  viewportClassName?: string
}

const toastManager = ToastPrimitive.createToastManager()

function ToastIcon({ type }: { type?: string }) {
  const icon =
    type === "success"
      ? CheckmarkCircle02Icon
      : type === "info"
        ? InformationCircleIcon
        : type === "warning"
          ? Alert02Icon
          : type === "error"
            ? MultiplicationSignCircleIcon
            : type === "loading"
              ? Loading03Icon
              : null

  if (!icon) return null

  return (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={2}
      className={cn(
        "mt-0.5 size-4 shrink-0",
        type === "loading" && "animate-spin",
      )}
    />
  )
}

function ToastProvider({ ...props }: ToastProviderProps) {
  return <ToastPrimitive.Provider data-slot="toast-provider" {...props} />
}

function ToastPortal({ className, ...props }: ToastPortalProps) {
  return (
    <ToastPrimitive.Portal
      data-slot="toast-portal"
      className={cn(className)}
      {...props}
    />
  )
}

function ToastViewport({ className, ...props }: ToastViewportProps) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "toaster group fixed z-50 flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
        className,
      )}
      {...props}
    />
  )
}

function ToastPositioner({ className, ...props }: ToastPositionerProps) {
  return (
    <ToastPrimitive.Positioner
      data-slot="toast-positioner"
      className={cn(className)}
      {...props}
    />
  )
}

function Toast({ className, ...props }: ToastRootProps) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "cn-toast group/toast pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-[var(--radius)] border border-border bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/5",
        "data-[type=success]:border-emerald-500/30 data-[type=success]:bg-emerald-500/5",
        "data-[type=error]:border-destructive/40 data-[type=error]:bg-destructive/5",
        "data-[type=loading]:border-foreground/10",
        "data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:slide-in-from-bottom-2",
        "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:slide-out-to-right-2",
        className,
      )}
      {...props}
    />
  )
}

function ToastContent({ className, ...props }: ToastContentProps) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "grid flex-1 gap-1 overflow-hidden",
        "data-[behind]:opacity-0 data-[expanded]:opacity-100",
        className,
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastTitleProps) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium leading-none", className)}
      {...props}
    />
  )
}

function ToastDescription({ className, ...props }: ToastDescriptionProps) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function ToastAction({ className, ...props }: ToastActionProps) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center rounded-xl border bg-background px-3 text-sm font-medium transition-colors",
        "hover:bg-accent/10 hover:text-primary",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

function ToastClose({ className, ...props }: ToastCloseProps) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      className={cn(
        "absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors",
        "hover:bg-accent/10 hover:text-primary",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  )
}

function ToastArrow({ className, ...props }: ToastArrowProps) {
  return (
    <ToastPrimitive.Arrow
      data-slot="toast-arrow"
      className={cn("fill-popover", className)}
      {...props}
    />
  )
}

function Toaster({ className, viewportClassName }: ToasterProps) {
  return (
    <ToastProvider toastManager={toastManager}>
      <ToastPortal>
        <ToastViewport className={viewportClassName}>
          <ToastList className={className} />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  )
}

function ToastList({ className }: { className?: string }) {
  const { toasts } = ToastPrimitive.useToastManager()

  return (
    <div data-slot="toast-list" className={cn("contents", className)}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast}>
          <ToastIcon type={toast.type} />
          <ToastContent>
            <ToastTitle />
            <ToastDescription />
          </ToastContent>
          <ToastClose aria-label="Close" />
        </Toast>
      ))}
    </div>
  )
}

export {
  toastManager,
  Toaster,
  Toast,
  ToastAction,
  ToastArrow,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastPositioner,
  ToastProvider,
  ToastTitle,
  ToastViewport,
}

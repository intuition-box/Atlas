"use client"

import * as React from "react"
import type { ControllerFieldState, ControllerRenderProps, FieldValues, FieldPath } from "react-hook-form"

import { apiGet } from "@/lib/api/client"
import { makeHandleCandidate, normalizeHandle, validateHandle } from "@/lib/handle"
import { cn } from "@/lib/utils"

import { fieldControlProps } from "@/components/ui/form"
import { CheckIcon } from "@/components/ui/icons"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

const CHECK_DEBOUNCE_MS = 350

type CheckStatus = "idle" | "checking" | "available" | "taken"

interface HandleFieldProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  /** Element ID passed by FormField for label association. */
  id: string
  /** RHF controller field object. */
  field: ControllerRenderProps<TFieldValues, TName>
  /** RHF controller field state. */
  fieldState: ControllerFieldState
  /** Current name field value — enables the "Suggest from name" button. */
  nameValue?: string
  /**
   * The handle currently owned by this entity.
   * Skips the availability check when the input matches (no point
   * confirming your own handle).
   */
  currentHandle?: string
  /**
   * Owner type for server-side availability check.
   * When set together with the handle passing client validation,
   * a debounced GET to `/api/handle/check` fires automatically.
   */
  ownerType?: "USER" | "COMMUNITY"
  /** Owner ID — pass for settings pages so the check accounts for reclaim windows. */
  ownerId?: string
  className?: string
}

/**
 * Shared handle input with live validation, normalization preview,
 * and name-based suggestion.
 *
 * Client-side `validateHandle()` runs synchronously on every keystroke.
 * When `ownerType` is provided and the format is valid, a debounced
 * server call checks real availability (taken, retired, cooldown, etc.).
 */
function HandleField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  id,
  field,
  fieldState,
  nameValue,
  currentHandle,
  ownerType,
  ownerId,
  className,
}: HandleFieldProps<TFieldValues, TName>) {
  const rawValue = String(field.value ?? "").trim()
  const normalized = rawValue ? normalizeHandle(rawValue) : ""

  // Client-side format validation (synchronous — no API call).
  const validation = normalized ? validateHandle(normalized) : null
  const isFormatValid = validation?.ok === true
  const formatError = validation && !validation.ok ? validation.error.message : null

  const isUnchanged = Boolean(currentHandle && normalized === currentHandle)

  // --- Server-side availability check (debounced) ---
  const [checkStatus, setCheckStatus] = React.useState<CheckStatus>("idle")
  const [checkError, setCheckError] = React.useState<string | null>(null)

  React.useEffect(() => {
    // Reset when conditions aren't met for a server check.
    if (!ownerType || !isFormatValid || isUnchanged || !normalized) {
      setCheckStatus("idle")
      setCheckError(null)
      return
    }

    setCheckStatus("checking")
    setCheckError(null)

    const timer = window.setTimeout(() => {
      const controller = new AbortController()

      const params: Record<string, string> = { handle: normalized, ownerType }
      if (ownerId) params.ownerId = ownerId

      apiGet<{ available: boolean; handle: string }>("/api/handle/check", params, {
        signal: controller.signal,
      })
        .then((res) => {
          if (controller.signal.aborted) return

          if (res.ok) {
            setCheckStatus("available")
            setCheckError(null)
          } else {
            setCheckStatus("taken")
            setCheckError(res.error.message)
          }
        })
        .catch(() => {
          // Network error / aborted — go back to idle silently.
          if (!controller.signal.aborted) {
            setCheckStatus("idle")
            setCheckError(null)
          }
        })

      // Cleanup: abort in-flight request if the value changes before it resolves.
      return () => controller.abort()
    }, CHECK_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [normalized, ownerType, ownerId, isFormatValid, isUnchanged])

  // --- Derived display flags ---
  const showNormalizationHint = rawValue.length > 0 && normalized.length > 0 && normalized !== rawValue
  const showSuggestButton = !rawValue && Boolean(nameValue?.trim())
  const showFormatError = Boolean(formatError) && !fieldState.invalid

  function applySuggestion() {
    const suggested = makeHandleCandidate(nameValue ?? "")
    if (suggested) {
      field.onChange(suggested as typeof field.value)
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Input
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...fieldControlProps(field, {
          id,
          invalid: fieldState.invalid || Boolean(formatError) || checkStatus === "taken",
        })}
        value={String(field.value ?? "")}
      />

      {/* Server availability status */}
      {checkStatus === "checking" ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          Checking availability…
        </span>
      ) : checkStatus === "available" ? (
        <span className="flex items-center gap-1.5 text-xs text-emerald-600">
          <CheckIcon className="size-3" />
          Available
        </span>
      ) : checkStatus === "taken" ? (
        <span className="text-xs text-destructive">{checkError ?? "Handle is not available"}</span>
      ) : null}

      {/* Client-side format error (only when server check isn't active) */}
      {showFormatError && checkStatus === "idle" ? (
        <span className="text-xs text-destructive">{formatError}</span>
      ) : null}

      {showNormalizationHint && checkStatus === "idle" && !showFormatError ? (
        <span className="text-xs text-muted-foreground">
          Will be saved as <span className="font-medium">{normalized}</span>
        </span>
      ) : null}

      {showSuggestButton ? (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline underline-offset-4"
          onClick={applySuggestion}
        >
          Suggest from name
        </button>
      ) : null}
    </div>
  )
}

export { HandleField }
export type { HandleFieldProps }

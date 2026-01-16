

"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { apiGet, apiPost } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"
import { ROUTES } from "@/lib/routes"

import { Button } from "@/components/ui/button"
import { Form, FormActions, FormField, FormMessage, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"

type CommunityApplicationQuestion = {
  id: string
  label: string
  description?: string | null
  required?: boolean | null
  /** Optional hint for rendering; defaults to "textarea". */
  kind?: "input" | "textarea" | null
  placeholder?: string | null
}

type CommunityGetResponse = {
  community: {
    id: string
    handle: string
    name: string
    description?: string | null
    image?: string | null
    isPublicDirectory: boolean
    isMembershipOpen: boolean
    config?: unknown
  }
}

type MembershipStatusResponse = {
  membership?: {
    status: string
    role?: string
    createdAt?: string
    updatedAt?: string
    approvedAt?: string | null
  } | null
  application?: {
    status: string
    createdAt?: string
    updatedAt?: string
  } | null
}

type SubmitResponse = {
  membership?: {
    status: string
  }
}

function asQuestions(config: unknown): CommunityApplicationQuestion[] {
  if (!config || typeof config !== "object") return []

  const record = config as Record<string, unknown>

  // We support a few likely keys to avoid coupling too hard.
  const candidates = [
    record.applicationQuestions,
    record.membershipQuestions,
    record.applyQuestions,
    record.questions,
  ]

  const arr = candidates.find((v) => Array.isArray(v))
  if (!Array.isArray(arr)) return []

  return arr
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null
      const q = raw as Record<string, unknown>
      const id = typeof q.id === "string" && q.id.trim() ? q.id.trim() : ""
      const label = typeof q.label === "string" && q.label.trim() ? q.label.trim() : ""
      if (!id || !label) return null

      const description = typeof q.description === "string" ? q.description : null
      const placeholder = typeof q.placeholder === "string" ? q.placeholder : null
      const required = typeof q.required === "boolean" ? q.required : null
      const kind = q.kind === "input" || q.kind === "textarea" ? q.kind : null

      return { id, label, description, placeholder, required, kind }
    })
    .filter((q): q is CommunityApplicationQuestion => !!q)
}

function statusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "In review"
    case "APPROVED":
      return "Accepted"
    case "REJECTED":
      return "Rejected"
    case "WITHDRAWN":
      return "Cancelled"
    case "BANNED":
      return "Banned"
    default:
      return status
  }
}

export default function CommunityApplyPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const communityHandle = String(params?.handle || "").trim()

  const [loading, setLoading] = React.useState(true)
  const [community, setCommunity] = React.useState<CommunityGetResponse["community"] | null>(null)
  const [questions, setQuestions] = React.useState<CommunityApplicationQuestion[]>([])
  const [membershipStatus, setMembershipStatus] = React.useState<string | null>(null)

  const schema = React.useMemo(() => {
    const shape: Record<string, z.ZodTypeAny> = {
      // Optional note field even if there are no questions.
      note: z.string().max(2000, "Note is too long").optional().or(z.literal("")),
    }

    for (const q of questions) {
      const base = z.string().max(4000, "Answer is too long")
      shape[q.id] = q.required ? base.trim().min(1, "This question is required") : base.optional().or(z.literal(""))
    }

    return z.object(shape)
  }, [questions])

  type ApplyValues = z.infer<typeof schema>

  const form = useForm<ApplyValues>({
    resolver: zodResolver(schema),
    defaultValues: { note: "" } as ApplyValues,
    mode: "onBlur",
  })

  const rootError = form.formState.errors.root?.message

  React.useEffect(() => {
    if (!communityHandle) return

    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      try {
        const communityRes = await apiGet<CommunityGetResponse>(
          "/api/community/get",
          { handle: communityHandle },
          { signal: controller.signal }
        )

        if (cancelled) return
        if (!communityRes.ok) {
          const err = communityRes.error
          const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)
          form.setError("root", { type: "server", message: parsed.formError || "Couldn’t load community." })
          setCommunity(null)
          setQuestions([])
          setMembershipStatus(null)
          return
        }

        setCommunity(communityRes.value.community)
        const qs = asQuestions(communityRes.value.community.config)
        setQuestions(qs)

        // Ensure form has keys for dynamic questions.
        for (const q of qs) {
          const current = form.getValues(q.id as keyof ApplyValues)
          if (typeof current === "undefined") {
            form.setValue(q.id as keyof ApplyValues, "" as any, { shouldDirty: false })
          }
        }

        // Membership/application status is only relevant if the user is signed in.
        // The endpoint itself can decide whether to return null.
        const statusRes = await apiGet<MembershipStatusResponse>(
          "/api/membership/status",
          { communityHandle },
          { signal: controller.signal }
        )

        if (cancelled) return

        if (statusRes.ok) {
          const s =
            (statusRes.value.membership && statusRes.value.membership.status) ||
            (statusRes.value.application && statusRes.value.application.status) ||
            null
          setMembershipStatus(typeof s === "string" ? s : null)
        } else {
          // If unauthenticated, we just treat it as no status.
          setMembershipStatus(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityHandle])

  const canApply = React.useMemo(() => {
    if (!community) return false
    if (!community.isPublicDirectory) return false
    if (!community.isMembershipOpen) return false

    if (!membershipStatus) return true

    // Users can re-apply if they withdrew/cancelled.
    if (membershipStatus === "WITHDRAWN") return true

    // In all other cases, block (pending/approved/rejected/banned).
    return false
  }, [community, membershipStatus])

  const statusBanner = React.useMemo(() => {
    if (!membershipStatus) return null

    if (membershipStatus === "WITHDRAWN") {
      return {
        tone: "neutral" as const,
        title: "Previous application cancelled",
        body: "You can submit a new application.",
      }
    }

    if (membershipStatus === "PENDING") {
      return {
        tone: "neutral" as const,
        title: "Application in review",
        body: "Your application is being reviewed. You can’t submit again right now.",
      }
    }

    if (membershipStatus === "APPROVED") {
      return {
        tone: "success" as const,
        title: "Accepted",
        body: "You’re already a member of this community.",
      }
    }

    if (membershipStatus === "BANNED") {
      return {
        tone: "danger" as const,
        title: "Banned",
        body: "You can’t apply to this community.",
      }
    }

    if (membershipStatus === "REJECTED") {
      return {
        tone: "danger" as const,
        title: "Application rejected",
        body: "You can’t submit again right now.",
      }
    }

    return {
      tone: "neutral" as const,
      title: `Status: ${statusLabel(membershipStatus)}`,
      body: "You can’t submit again right now.",
    }
  }, [membershipStatus])

  async function onSubmit(values: ApplyValues) {
    form.clearErrors("root")

    if (!community) {
      form.setError("root", { type: "validate", message: "Community not found." })
      return
    }

    if (!community.isPublicDirectory || !community.isMembershipOpen) {
      form.setError("root", { type: "validate", message: "This community is not accepting applications." })
      return
    }

    if (!canApply) {
      form.setError("root", { type: "validate", message: "You can’t submit another application." })
      return
    }

    const answers: Record<string, string> = {}

    for (const q of questions) {
      const v = String((values as any)[q.id] ?? "").trim()
      if (!v && q.required) {
        form.setError(q.id as any, { type: "validate", message: "This question is required" })
        return
      }
      answers[q.id] = v
    }

    const note = String((values as any).note ?? "").trim()

    const result = await apiPost<SubmitResponse>("/api/membership/submit", {
      communityHandle,
      answers,
      note: note || null,
    })

    if (result.ok) {
      // Refresh status and bounce back to the community page.
      router.refresh()
      router.replace(`/c/${communityHandle}`)
      return
    }

    const err = result.error
    const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)

    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (key in form.getValues()) {
        form.setError(key as any, { type: "server", message })
      }
    }

    form.setError("root", { type: "server", message: parsed.formError || "Couldn’t submit application." })
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Apply</h1>
        <p className="text-sm text-muted-foreground">
          {community ? (
            <>
              Apply to <span className="font-medium text-foreground">{community.name}</span>.
            </>
          ) : (
            "Submit an application to join this community."
          )}
        </p>
      </header>

      {rootError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <FormMessage className="text-destructive">{rootError}</FormMessage>
        </div>
      ) : null}

      {statusBanner ? (
        <div
          className={
            statusBanner.tone === "danger"
              ? "rounded-2xl border border-destructive/30 bg-destructive/5 p-4"
              : statusBanner.tone === "success"
                ? "rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4"
                : "rounded-2xl border border-border/60 bg-muted/30 p-4"
          }
        >
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">{statusBanner.title}</div>
            <div className="text-sm text-muted-foreground">{statusBanner.body}</div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !community ? (
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
          This community doesn’t exist or is not available.
        </div>
      ) : !community.isPublicDirectory ? (
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
          Applications are only available for communities listed publicly.
        </div>
      ) : !community.isMembershipOpen ? (
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
          This community is not accepting applications right now.
        </div>
      ) : (
        <Form form={form} onSubmit={onSubmit} className="flex flex-col gap-10">
          <div className="flex flex-col gap-8">
            {questions.length ? (
              <div className="flex flex-col gap-8">
                {questions.map((q) => (
                  <FormField<ApplyValues, any>
                    key={q.id}
                    name={q.id as any}
                    label={q.label}
                    required={!!q.required}
                    description={q.description ? q.description : undefined}
                    render={({ id, field, fieldState }) => {
                      const kind = q.kind || "textarea"
                      return kind === "input" ? (
                        <Input
                          {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                          value={String(field.value ?? "")}
                          placeholder={q.placeholder ? q.placeholder : undefined}
                          disabled={!canApply}
                        />
                      ) : (
                        <Textarea
                          {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                          value={String(field.value ?? "")}
                          placeholder={q.placeholder ? q.placeholder : undefined}
                          rows={4}
                          disabled={!canApply}
                          className="bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 flex w-full min-w-0 rounded-2xl border px-3 py-2 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-[3px] aria-invalid:ring-[3px]"
                        />
                      )
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                This community doesn’t have any application questions yet.
              </div>
            )}

            <Field data-slot="community-apply-note" name="note" invalid={!!form.formState.errors.note}>
              <FieldLabel>Optional note</FieldLabel>
              <FieldDescription>Anything else you want moderators to know.</FieldDescription>

              <FormField<ApplyValues, "note">
                name="note"
                render={({ id, field, fieldState }) => (
                  <Textarea
                    {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                    value={String(field.value ?? "")}
                    rows={3}
                    disabled={!canApply}
                    className="bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 flex w-full min-w-0 rounded-2xl border px-3 py-2 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-[3px] aria-invalid:ring-[3px]"
                  />
                )}
              />

              {form.formState.errors.note?.message ? (
                <FieldError>{String(form.formState.errors.note.message)}</FieldError>
              ) : null}
            </Field>
          </div>

          <FormActions className="flex items-center gap-3">
            <Button type="submit" disabled={!canApply || form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Submitting…" : "Submit application"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                router.replace(`/c/${communityHandle}`)
              }}
            >
              Back
            </Button>
          </FormActions>
        </Form>
      )}
    </main>
  )
}
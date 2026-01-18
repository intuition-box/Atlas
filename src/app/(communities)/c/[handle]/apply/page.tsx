"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { apiGet, apiPost } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"

import { PageHeader } from "@/components/common/page-header"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Form, FormActions, FormField, FormMessage, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { UsersIcon } from "@/components/ui/icons"

// === TYPES ===

type MembershipStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "BANNED"

type CommunityApplicationQuestion = {
  id: string
  label: string
  description: string | null
  required: boolean
  kind: "input" | "textarea" | null
  placeholder: string | null
}

type CommunityInfo = {
  id: string
  handle: string
  name: string
  description?: string | null
  image?: string | null
  isPublicDirectory: boolean
  isMembershipOpen: boolean
  config?: unknown
}

type CommunityGetResponse = {
  community: CommunityInfo
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

type StatusBanner = {
  tone: "neutral" | "success" | "danger"
  title: string
  body: string
}

// === UTILITY FUNCTIONS ===

function parseQuestions(config: unknown): CommunityApplicationQuestion[] {
  if (!config || typeof config !== "object") return []

  const record = config as Record<string, unknown>

  const candidates = [
    record.applicationQuestions,
    record.membershipQuestions,
    record.applyQuestions,
    record.questions,
  ]

  const arr = candidates.find((v) => Array.isArray(v))
  if (!Array.isArray(arr)) return []

  return (arr as unknown[])
    .map((raw): CommunityApplicationQuestion | null => {
      if (!raw || typeof raw !== "object") return null

      const q = raw as Record<string, unknown>
      const id = typeof q.id === "string" && q.id.trim() ? q.id.trim() : ""
      const label = typeof q.label === "string" && q.label.trim() ? q.label.trim() : ""

      if (!id || !label) return null

      const description = typeof q.description === "string" ? q.description : null
      const placeholder = typeof q.placeholder === "string" ? q.placeholder : null
      const required = q.required === true
      const kind: CommunityApplicationQuestion["kind"] =
        q.kind === "input" || q.kind === "textarea" ? q.kind : null

      return { id, label, description, placeholder, required, kind }
    })
    .filter((q): q is CommunityApplicationQuestion => q !== null)
}

function getStatusLabel(status: string): string {
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

function createStatusBanner(status: string | null): StatusBanner | null {
  if (!status) return null

  if (status === "WITHDRAWN") {
    return {
      tone: "neutral",
      title: "Previous application cancelled",
      body: "You can submit a new application.",
    }
  }

  if (status === "PENDING") {
    return {
      tone: "neutral",
      title: "Application in review",
      body: "Your application is being reviewed. You can't submit again right now.",
    }
  }

  if (status === "APPROVED") {
    return {
      tone: "success",
      title: "Accepted",
      body: "You're already a member of this community.",
    }
  }

  if (status === "BANNED") {
    return {
      tone: "danger",
      title: "Banned",
      body: "You can't apply to this community.",
    }
  }

  if (status === "REJECTED") {
    return {
      tone: "danger",
      title: "Application rejected",
      body: "You can't submit again right now.",
    }
  }

  return {
    tone: "neutral",
    title: `Status: ${getStatusLabel(status)}`,
    body: "You can't submit again right now.",
  }
}

function canUserApply(community: CommunityInfo | null, membershipStatus: string | null): boolean {
  if (!community) return false
  if (!community.isPublicDirectory) return false
  if (!community.isMembershipOpen) return false
  if (!membershipStatus) return true
  if (membershipStatus === "WITHDRAWN") return true

  return false
}

function buildDynamicSchema(questions: CommunityApplicationQuestion[]) {
  const shape: Record<string, z.ZodTypeAny> = {
    note: z.string().max(2000, "Note is too long").optional().or(z.literal("")),
  }

  for (const q of questions) {
    const base = z.string().max(4000, "Answer is too long")
    shape[q.id] = q.required
      ? base.trim().min(1, "This question is required")
      : base.optional().or(z.literal(""))
  }

  return z.object(shape)
}

// === CUSTOM HOOKS ===

function useCommunityData(handle: string) {
  const [community, setCommunity] = React.useState<CommunityInfo | null>(null)
  const [questions, setQuestions] = React.useState<CommunityApplicationQuestion[]>([])
  const [membershipStatus, setMembershipStatus] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!handle) {
      setLoading(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const communityRes = await apiGet<CommunityGetResponse>(
          "/api/community/get",
          { handle },
          { signal: controller.signal }
        )

        if (cancelled) return

        if (!communityRes.ok) {
          const err = communityRes.error
          const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)
          setError(parsed.formError || "Couldn't load community.")
          setCommunity(null)
          setQuestions([])
          setMembershipStatus(null)
          setLoading(false)
          return
        }

        const communityData = communityRes.value.community
        setCommunity(communityData)

        const parsedQuestions = parseQuestions(communityData.config)
        setQuestions(parsedQuestions)

        const statusRes = await apiGet<MembershipStatusResponse>(
          "/api/membership/status",
          { communityHandle: handle },
          { signal: controller.signal }
        )

        if (cancelled) return

        if (statusRes.ok) {
          const s =
            (statusRes.value.membership?.status) ||
            (statusRes.value.application?.status) ||
            null
          setMembershipStatus(typeof s === "string" ? s : null)
        } else {
          setMembershipStatus(null)
        }

        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError("An unexpected error occurred while loading the community.")
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [handle])

  return { community, questions, membershipStatus, loading, error }
}

// === SUB-COMPONENTS ===

function StatusBannerComponent({ banner }: { banner: StatusBanner }) {
  const className =
    banner.tone === "danger"
      ? "rounded-2xl border border-destructive/30 bg-destructive/5 p-4"
      : banner.tone === "success"
        ? "rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4"
        : "rounded-2xl border border-border/60 bg-muted/30 p-4"

  return (
    <div className={className}>
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">{banner.title}</div>
        <div className="text-sm text-muted-foreground">{banner.body}</div>
      </div>
    </div>
  )
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function ApplicationQuestions({
  questions,
  canApply,
  form,
}: {
  questions: CommunityApplicationQuestion[]
  canApply: boolean
  form: ReturnType<typeof useForm<any>>
}) {
  if (questions.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        This community doesn't have any application questions yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {questions.map((q) => (
        <FormField
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
              />
            )
          }}
        />
      ))}
    </div>
  )
}

function OptionalNoteField({
  canApply,
  form,
}: {
  canApply: boolean
  form: ReturnType<typeof useForm<any>>
}) {
  return (
    <Field data-slot="community-apply-note" name="note" invalid={!!form.formState.errors.note}>
      <FieldLabel>Optional note</FieldLabel>
      <FieldDescription>Anything else you want moderators to know.</FieldDescription>

      <FormField
        name="note"
        render={({ id, field, fieldState }) => (
          <Textarea
            {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
            value={String(field.value ?? "")}
            rows={3}
            disabled={!canApply}
          />
        )}
      />

      {form.formState.errors.note?.message && (
        <FieldError>{String(form.formState.errors.note.message)}</FieldError>
      )}
    </Field>
  )
}

// === MAIN COMPONENT ===

export default function CommunityApplyPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const communityHandle = String(params?.handle || "").trim()

  const { community, questions, membershipStatus, loading, error } = useCommunityData(communityHandle)

  const schema = React.useMemo(() => buildDynamicSchema(questions), [questions])
  type ApplyValues = z.infer<typeof schema>

  const form = useForm<ApplyValues>({
    resolver: zodResolver(schema),
    defaultValues: { note: "" } as ApplyValues,
    mode: "onBlur",
  })

  const canApply = React.useMemo(
    () => canUserApply(community, membershipStatus),
    [community, membershipStatus]
  )

  const statusBanner = React.useMemo(
    () => createStatusBanner(membershipStatus),
    [membershipStatus]
  )

  // Initialize form values for dynamic questions
  React.useEffect(() => {
    for (const q of questions) {
      const current = form.getValues(q.id as keyof ApplyValues)
      if (typeof current === "undefined") {
        form.setValue(q.id as keyof ApplyValues, "" as any, { shouldDirty: false })
      }
    }
  }, [questions, form])

  // Set error from hook
  React.useEffect(() => {
    if (error) {
      form.setError("root", { type: "server", message: error })
    }
  }, [error, form])

  async function handleSubmit(values: ApplyValues) {
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
      form.setError("root", { type: "validate", message: "You can't submit another application." })
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

    form.setError("root", { type: "server", message: parsed.formError || "Couldn't submit application." })
  }

  function handleCancel() {
    router.replace(`/c/${communityHandle}`)
  }

  const rootError = form.formState.errors.root?.message

  const communityName = String(community?.name || "").trim() || "Community"

  if (!communityHandle) return null

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-10">
      {rootError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <FormMessage className="text-destructive">{rootError}</FormMessage>
        </div>
      )}

      {statusBanner && <StatusBannerComponent banner={statusBanner} />}

      {loading ? (
        <>
          <PageHeader
            title="Apply"
            description={`/c/${communityHandle}`}
            actions={
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Back
              </Button>
            }
          />
          <InfoBox>Loading…</InfoBox>
        </>
      ) : !community ? (
        <>
          <PageHeader
            title="Apply"
            description={`/c/${communityHandle}`}
            actions={
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Back
              </Button>
            }
          />
          <InfoBox>This community doesn't exist or is not available.</InfoBox>
        </>
      ) : !community.isPublicDirectory ? (
        <>
          <PageHeader
            leading={
              <Avatar className="h-12 w-12">
                <AvatarImage src={community.image ?? undefined} alt={communityName} />
                <AvatarFallback>
                  <UsersIcon />
                </AvatarFallback>
              </Avatar>
            }
            title="Apply"
            description={`/c/${communityHandle}`}
            actions={
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Back
              </Button>
            }
          />
          <InfoBox>Applications are only available for communities listed publicly.</InfoBox>
        </>
      ) : !community.isMembershipOpen ? (
        <>
          <PageHeader
            leading={
              <Avatar className="h-12 w-12">
                <AvatarImage src={community.image ?? undefined} alt={communityName} />
                <AvatarFallback>
                  <UsersIcon />
                </AvatarFallback>
              </Avatar>
            }
            title="Apply"
            description={`/c/${communityHandle}`}
            actions={
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Back
              </Button>
            }
          />
          <InfoBox>This community is not accepting applications right now.</InfoBox>
        </>
      ) : (
        <Form form={form} onSubmit={handleSubmit} className="flex flex-col gap-10">
          <PageHeader
            leading={
              <Avatar className="h-12 w-12">
                <AvatarImage src={community.image ?? undefined} alt={communityName} />
                <AvatarFallback><UsersIcon /></AvatarFallback>
              </Avatar>
            }
            title="Apply"
            description={`/c/${communityHandle}`}
            actions={
              <FormActions className="flex items-center gap-3">
                <Button type="submit" disabled={!canApply || form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Submitting…" : "Submit"}
                </Button>
                <Button type="button" variant="secondary" onClick={handleCancel}>
                  Back
                </Button>
              </FormActions>
            }
          />

          <div className="flex flex-col gap-8">
            <ApplicationQuestions questions={questions} canApply={canApply} form={form} />
            <OptionalNoteField canApply={canApply} form={form} />
          </div>
        </Form>
      )}
    </main>
  )
}
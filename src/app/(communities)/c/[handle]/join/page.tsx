"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { communityPath, ROUTES } from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Form, FormActions, FormField, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

// === TYPES ===

type JoinQuestion = {
  id: string
  label: string
  help: string | null
  required: boolean
  type: "text" | "textarea" | null
  placeholder: string | null
}

type CommunityInfo = {
  id: string
  handle: string
  name: string
  description?: string | null
  avatarUrl?: string | null
  isPublicDirectory: boolean
  isMembershipOpen: boolean
  membershipConfig?: unknown
}

type CommunityGetResponse = {
  community: CommunityInfo
  viewerMembership: {
    status: string
    role: string
  } | null
}

type ExistingApplication = {
  id: string
  status: string
  answers: unknown
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
  reviewNote: string | null
}

type ApplicationGetResponse = {
  application: ExistingApplication | null
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

function parseQuestions(config: unknown): JoinQuestion[] {
  if (!config || typeof config !== "object") return []

  const record = config as Record<string, unknown>

  const candidates = [
    record.applicationQuestions,
    record.joinQuestions,
    record.membershipQuestions,
    record.applyQuestions,
    record.questions,
  ]

  const arr = candidates.find((v) => Array.isArray(v))
  if (!Array.isArray(arr)) return []

  return (arr as unknown[])
    .map((raw): JoinQuestion | null => {
      if (!raw || typeof raw !== "object") return null

      const q = raw as Record<string, unknown>
      const id = typeof q.id === "string" && q.id.trim() ? q.id.trim() : ""
      const label = typeof q.label === "string" && q.label.trim() ? q.label.trim() : ""

      if (!id || !label) return null

      const help = typeof q.help === "string" ? q.help : null
      const placeholder = typeof q.placeholder === "string" ? q.placeholder : null
      const required = q.required === true
      const type: JoinQuestion["type"] =
        q.type === "text" || q.type === "textarea" ? q.type : null

      return { id, label, help, placeholder, required, type }
    })
    .filter((q): q is JoinQuestion => q !== null)
}

/** Extract previous answers from an existing application's JSON. */
function extractPreviousAnswers(
  answers: unknown,
  questions: JoinQuestion[],
): Record<string, string> {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {}

  const rec = answers as Record<string, unknown>
  const result: Record<string, string> = {}

  for (const q of questions) {
    const v = rec[q.id]
    if (typeof v === "string") {
      result[q.id] = v
    }
  }

  // Extract note if present
  const note = rec.note
  if (typeof note === "string") {
    result.note = note
  }

  return result
}

function createStatusBanner(
  membershipStatus: string | null,
  existingApp: ExistingApplication | null,
): StatusBanner | null {
  if (!membershipStatus) return null

  if (membershipStatus === "WITHDRAWN") {
    return {
      tone: "neutral",
      title: "Previous request cancelled",
      body: "You can submit a new join request.",
    }
  }

  if (membershipStatus === "PENDING") {
    const updatedAt = existingApp?.updatedAt
    const timeAgo = updatedAt ? formatRelativeTime(updatedAt) : null
    return {
      tone: "neutral",
      title: "Application in review",
      body: timeAgo
        ? `Submitted ${timeAgo.toLowerCase()}. You can update your answers and resubmit.`
        : "Your application is being reviewed. You can update your answers and resubmit.",
    }
  }

  if (membershipStatus === "APPROVED") {
    return {
      tone: "success",
      title: "Accepted",
      body: "You're already a member of this community.",
    }
  }

  if (membershipStatus === "BANNED") {
    return {
      tone: "danger",
      title: "Banned",
      body: "You can't join this community.",
    }
  }

  if (membershipStatus === "REJECTED") {
    return {
      tone: "danger",
      title: "Application not accepted",
      body: existingApp?.reviewNote
        ? `Your previous application was not accepted. You can update your answers and resubmit.`
        : "Your previous application was not accepted. You can update your answers and resubmit.",
    }
  }

  return {
    tone: "neutral",
    title: `Status: ${membershipStatus}`,
    body: "You can't submit right now.",
  }
}

function canUserJoin(community: CommunityInfo | null, membershipStatus: string | null): boolean {
  if (!community) return false
  if (!community.isPublicDirectory) return false
  if (!community.isMembershipOpen) return false
  if (!membershipStatus) return true
  if (membershipStatus === "WITHDRAWN") return true
  if (membershipStatus === "PENDING") return true
  if (membershipStatus === "REJECTED") return true

  return false
}

function formatRelativeTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ""

  const diff = Date.now() - d.getTime()
  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function buildDynamicSchema(questions: JoinQuestion[]) {
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

/** Returns the submit button label based on application state. */
function getSubmitLabel(
  membershipStatus: string | null,
  existingApp: ExistingApplication | null,
  isSubmitting: boolean,
): string {
  if (isSubmitting) return "Submitting\u2026"

  if (membershipStatus === "PENDING" && existingApp) return "Update"
  if (membershipStatus === "REJECTED" && existingApp) return "Resubmit"
  return "Submit"
}

// === CUSTOM HOOKS ===

function useCommunityData(handle: string) {
  const [community, setCommunity] = React.useState<CommunityInfo | null>(null)
  const [questions, setQuestions] = React.useState<JoinQuestion[]>([])
  const [membershipStatus, setMembershipStatus] = React.useState<string | null>(null)
  const [existingApp, setExistingApp] = React.useState<ExistingApplication | null>(null)
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
        // Fetch community info + viewer membership status.
        const communityRes = await apiGet<CommunityGetResponse>(
          "/api/community/get",
          { handle },
          { signal: controller.signal }
        )

        if (cancelled) return

        if (!communityRes.ok) {
          const err = communityRes.error
          const parsed = parseApiError(err)
          setError(parsed.formError || "Couldn't load community.")
          setCommunity(null)
          setQuestions([])
          setMembershipStatus(null)
          setExistingApp(null)
          setLoading(false)
          return
        }

        const communityData = communityRes.value.community
        setCommunity(communityData)

        const parsedQuestions = parseQuestions(communityData.membershipConfig)
        setQuestions(parsedQuestions)

        const viewerStatus = communityRes.value.viewerMembership?.status ?? null
        setMembershipStatus(viewerStatus)

        // If user has an active/past application, fetch it for pre-filling.
        if (viewerStatus === "PENDING" || viewerStatus === "REJECTED" || viewerStatus === "WITHDRAWN") {
          const appRes = await apiGet<ApplicationGetResponse>(
            "/api/application/get",
            { communityHandle: handle },
            { signal: controller.signal },
          )

          if (cancelled) return

          if (appRes.ok) {
            setExistingApp(appRes.value.application)
          }
        } else {
          setExistingApp(null)
        }

        setLoading(false)
      } catch {
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

  return { community, questions, membershipStatus, existingApp, loading, error }
}

// === SUB-COMPONENTS ===

function StatusBannerAlert({ banner }: { banner: StatusBanner }) {
  return (
    <Alert variant={banner.tone === "danger" ? "destructive" : "default"}>
      <AlertTitle>{banner.title}</AlertTitle>
      <AlertDescription>{banner.body}</AlertDescription>
    </Alert>
  )
}

function JoinQuestions({
  questions,
  canJoin,
  form,
}: {
  questions: JoinQuestion[]
  canJoin: boolean
  form: ReturnType<typeof useForm<any>>
}) {
  if (questions.length === 0) {
    return (
      <Alert>
        <AlertDescription>This community doesn't have any questions yet.</AlertDescription>
      </Alert>
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
          description={q.help ? q.help : undefined}
          render={({ id, field, fieldState }) => {
            return q.type === "text" ? (
              <Input
                {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                value={String(field.value ?? "")}
                placeholder={q.placeholder ? q.placeholder : undefined}
                disabled={!canJoin}
              />
            ) : (
              <Textarea
                {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                value={String(field.value ?? "")}
                placeholder={q.placeholder ? q.placeholder : undefined}
                rows={4}
                disabled={!canJoin}
              />
            )
          }}
        />
      ))}
    </div>
  )
}

function OptionalNoteField({
  canJoin,
  form,
}: {
  canJoin: boolean
  form: ReturnType<typeof useForm<any>>
}) {
  return (
    <Field data-slot="community-join-note" name="note" invalid={!!form.formState.errors.note}>
      <FieldLabel>Optional note</FieldLabel>
      <FieldDescription>Anything else you want moderators to know.</FieldDescription>

      <FormField
        name="note"
        render={({ id, field, fieldState }) => (
          <Textarea
            {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
            value={String(field.value ?? "")}
            rows={3}
            disabled={!canJoin}
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

export default function CommunityJoinPage() {
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()
  const params = useParams<{ handle: string }>()
  const communityHandle = String(params?.handle || "").trim()

  const { community, questions, membershipStatus, existingApp, loading, error } =
    useCommunityData(communityHandle)

  const schema = React.useMemo(() => buildDynamicSchema(questions), [questions])
  type JoinValues = z.infer<typeof schema>

  const form = useForm<JoinValues>({
    resolver: zodResolver(schema),
    defaultValues: { note: "" } as JoinValues,
    mode: "onBlur",
  })

  const canJoin = React.useMemo(
    () => canUserJoin(community, membershipStatus),
    [community, membershipStatus]
  )

  const statusBanner = React.useMemo(
    () => createStatusBanner(membershipStatus, existingApp),
    [membershipStatus, existingApp]
  )

  // Redirect to sign-in if not authenticated
  React.useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.replace(ROUTES.signIn)
    }
  }, [sessionStatus, router])

  // Pre-fill form with previous answers when an existing application loads.
  const hasPreFilled = React.useRef(false)
  React.useEffect(() => {
    if (hasPreFilled.current) return
    if (!existingApp || questions.length === 0) return

    const prev = extractPreviousAnswers(existingApp.answers, questions)
    if (Object.keys(prev).length === 0) return

    hasPreFilled.current = true
    form.reset({ ...form.getValues(), ...prev }, { keepDefaultValues: true })
  }, [existingApp, questions, form])

  // Initialize form values for dynamic questions (only when no existing app).
  React.useEffect(() => {
    if (existingApp) return
    for (const q of questions) {
      const current = form.getValues(q.id as keyof JoinValues)
      if (typeof current === "undefined") {
        form.setValue(q.id as keyof JoinValues, "" as any, { shouldDirty: false })
      }
    }
  }, [questions, form, existingApp])

  // Set error from hook
  React.useEffect(() => {
    if (error) {
      form.setError("root", { type: "server", message: error })
    }
  }, [error, form])

  async function handleSubmit(values: JoinValues) {
    form.clearErrors("root")

    if (!community) {
      form.setError("root", { type: "validate", message: "Community not found." })
      return
    }

    if (!community.isPublicDirectory || !community.isMembershipOpen) {
      form.setError("root", { type: "validate", message: "This community is not accepting new members." })
      return
    }

    if (!canJoin) {
      form.setError("root", { type: "validate", message: "You can't submit another join request." })
      return
    }

    const answers: Record<string, unknown> = {}
    const _questionLabels: Record<string, string> = {}

    for (const q of questions) {
      const v = String((values as any)[q.id] ?? "").trim()
      if (!v && q.required) {
        form.setError(q.id as any, { type: "validate", message: "This question is required" })
        return
      }
      answers[q.id] = v
      _questionLabels[q.id] = q.label
    }

    // Snapshot question labels so they survive admin config changes.
    answers._questionLabels = _questionLabels

    const note = String((values as any).note ?? "").trim()

    const result = await apiPost<SubmitResponse>("/api/membership/submit", {
      communityHandle,
      answers,
      note: note || null,
    })

    if (result.ok) {
      router.refresh()
      router.replace(communityPath(communityHandle))
      return
    }

    const err = result.error
    const parsed = parseApiError(err)

    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (key in form.getValues()) {
        form.setError(key as any, { type: "server", message })
      }
    }

    form.setError("root", { type: "server", message: parsed.formError || "Couldn't submit join request." })
  }

  const rootError = form.formState.errors.root?.message

  const communityName = String(community?.name || "").trim() || "Community"

  const submitLabel = getSubmitLabel(membershipStatus, existingApp, form.formState.isSubmitting)

  if (!communityHandle) return null

  // Don't render while checking session
  if (sessionStatus === "loading" || sessionStatus === "unauthenticated") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
        <div className="w-full flex flex-wrap items-center gap-3 p-5">
          <Skeleton className="size-12 rounded-full shrink-0" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      {loading ? (
        <>
          <div className="w-full flex flex-wrap items-center gap-3 p-5">
            <Skeleton className="size-12 rounded-full shrink-0" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </>
      ) : !community ? (
        <>
          <PageHeader
            title="Join"
            description={`@${communityHandle}`}
          />
          <Alert>
            <AlertDescription>This community doesn't exist or is not available.</AlertDescription>
          </Alert>
        </>
      ) : !community.isPublicDirectory ? (
        <>
          <PageHeader
            leading={
              <ProfileAvatar type="community" src={community.avatarUrl} name={communityName} className="h-12 w-12" />
            }
            title="Join"
            description={`@${communityHandle}`}
          />
          <Alert>
            <AlertDescription>Join requests are only available for communities listed publicly.</AlertDescription>
          </Alert>
        </>
      ) : !community.isMembershipOpen ? (
        <>
          <PageHeader
            leading={
              <ProfileAvatar type="community" src={community.avatarUrl} name={communityName} className="h-12 w-12" />
            }
            title="Join"
            description={`@${communityHandle}`}
          />
          <Alert>
            <AlertDescription>This community is not accepting new members right now.</AlertDescription>
          </Alert>
        </>
      ) : !canJoin && statusBanner ? (
        <>
          <PageHeader
            leading={
              <ProfileAvatar type="community" src={community.avatarUrl} name={communityName} className="h-12 w-12" />
            }
            title="Join"
            description={`@${communityHandle}`}
          />
          <StatusBannerAlert banner={statusBanner} />
        </>
      ) : (
        <Form form={form} onSubmit={handleSubmit} className="gap-10">
          <PageHeader
            leading={
              <ProfileAvatar type="community" src={community.avatarUrl} name={communityName} className="h-12 w-12" />
            }
            title="Join"
            description={`@${communityHandle}`}
            sticky
            actions={
              <FormActions className="flex items-center gap-3">
                <Button type="submit" variant="solid" disabled={!canJoin || form.formState.isSubmitting}>
                  {submitLabel}
                </Button>
              </FormActions>
            }
          />

          {statusBanner && <StatusBannerAlert banner={statusBanner} />}

          {rootError && (
            <Alert variant="destructive">
              <AlertDescription>{rootError}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardContent className="flex flex-col gap-8">
              <JoinQuestions questions={questions} canJoin={canJoin} form={form} />
              <OptionalNoteField canJoin={canJoin} form={form} />
            </CardContent>
          </Card>
        </Form>
      )}
    </div>
  )
}

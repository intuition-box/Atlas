"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useParams, useRouter } from "next/navigation"
import { getSession } from "next-auth/react"
import { apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { communityPath, communitySettingsPath } from "@/lib/routes"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { HandleField } from "@/components/common/handle-field"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { UnsavedChangesBar } from "@/components/common/unsaved-changes-bar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormField, fieldControlProps, useForm } from "@/components/ui/form"
import { Globe, Users } from "lucide-react"
import { DiscordIcon, GitHubIcon, TelegramIcon, XIcon } from "@/components/ui/icons"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { useFieldArray } from "react-hook-form"

import { useCommunity, type CommunityData } from "../community-provider"
import { hasPermission } from "@/lib/permissions-shared"

// === SCHEMAS ===

const ApplicationQuestionSchema = z.object({
  id: z.string().trim().min(1, "Question id is required"),
  label: z.string().trim().min(1, "Question is required").max(200, "Question is too long"),
  type: z.enum(["text", "textarea"], { message: "Type is required" }),
  required: z.boolean(),
  placeholder: z.string().max(240, "Placeholder is too long").optional().or(z.literal("")),
  help: z.string().max(400, "Help text is too long").optional().or(z.literal("")),
})

const CommunitySettingsSchema = z.object({
  handle: z.string().trim().min(1, "Handle is required"),
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  description: z.string().max(2000, "Description is too long"),
  avatarUrl: z.string().url("Enter a valid image URL").optional().or(z.literal("")),
  isPublicDirectory: z.boolean(),
  isMembershipOpen: z.boolean(),
  autoOrbitPlacement: z.boolean(),
  applicationQuestions: z.array(ApplicationQuestionSchema),
  discordUrl: z.string().max(2048, "URL is too long"),
  xUrl: z.string().max(2048, "URL is too long"),
  telegramUrl: z.string().max(2048, "URL is too long"),
  githubUrl: z.string().max(2048, "URL is too long"),
  websiteUrl: z.string().max(2048, "URL is too long"),
})

type CommunitySettingsValues = z.infer<typeof CommunitySettingsSchema>

// === API TYPES ===

type CommunityUpdateResponse = {
  community: {
    handle: string
  }
}

// === UTILITY FUNCTIONS ===

function generateQuestionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `q_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function optionalString(value: string | undefined | null): string | undefined {
  const trimmed = String(value ?? "").trim()
  return trimmed || undefined
}

const SOCIAL_BASES: Record<string, string> = {
  discordUrl: "https://discord.gg/",
  xUrl: "https://x.com/",
  telegramUrl: "https://t.me/",
  githubUrl: "https://github.com/",
}

/**
 * Normalize a social link field value into a full `https://` URL.
 *
 * - Empty / whitespace → `null`
 * - Already a full URL → force `https://`
 * - Contains a dot (e.g. `x.com/handle`) → prepend `https://`
 * - Plain handle (e.g. `wavedotso`) → prepend platform base URL
 * - Website field → just ensure `https://` prefix
 */
function normalizeSocialUrl(
  value: string | undefined | null,
  field: string,
): string | null {
  const trimmed = String(value ?? "").trim().replace(/^@/, "")
  if (!trimmed) return null

  // Already has a protocol → force https
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, "https://")
  }

  // Website field: just prepend https://
  if (field === "websiteUrl") {
    return `https://${trimmed}`
  }

  // Contains a dot → looks like a domain (e.g. "x.com/handle")
  if (trimmed.includes(".")) {
    return `https://${trimmed}`
  }

  // Plain handle → prepend platform base
  const base = SOCIAL_BASES[field]
  return base ? `${base}${trimmed}` : `https://${trimmed}`
}

function parseApplicationQuestions(membershipConfig: Record<string, unknown>): CommunitySettingsValues["applicationQuestions"] {
  const questionsRaw = Array.isArray(membershipConfig.applicationQuestions)
    ? membershipConfig.applicationQuestions
    : []

  return questionsRaw
    .map((q) => {
      if (!q || typeof q !== "object") return null

      const record = q as Record<string, unknown>
      const id = typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : generateQuestionId()
      const label = typeof record.label === "string" ? record.label : ""
      const type: "text" | "textarea" = record.type === "textarea" ? "textarea" : "text"
      const required = typeof record.required === "boolean" ? record.required : false
      const placeholder = typeof record.placeholder === "string" ? record.placeholder : ""
      const help = typeof record.help === "string" ? record.help : ""

      return { id, label, type, required, placeholder, help }
    })
    .filter((q): q is NonNullable<typeof q> =>
      q !== null && !!(q.label.trim() || q.placeholder.trim() || q.help.trim())
    )
}

// === CUSTOM HOOKS ===

function useSessionUser() {
  const [user, setUser] = React.useState<{ id: string; handle: string } | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false

    getSession().then((session) => {
      if (cancelled) return

      const sessionUser = session?.user as any
      const id = sessionUser?.id ?? sessionUser?.userId ?? sessionUser?.sub ?? ""
      const handle = sessionUser?.handle ?? ""

      setUser(id || handle ? { id, handle } : null)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setUser(null)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [])

  return { user, loading }
}


// === CONTENT SKELETON ===

function SettingsContentSkeleton() {
  return (
    <>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-9 w-28 rounded-4xl" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-28 w-full rounded-2xl" />
        </CardContent>
      </Card>
    </>
  )
}

// === COMPONENT ===

export default function CommunitySettingsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const communityHandle = String(params?.handle || "")
  const ctx = useCommunity()
  const community = ctx.community

  const { user: sessionUser, loading: sessionLoading } = useSessionUser()

  const form = useForm<CommunitySettingsValues>({
    resolver: zodResolver(CommunitySettingsSchema),
    defaultValues: {
      handle: "",
      name: "",
      description: "",
      avatarUrl: "",
      isPublicDirectory: true,
      isMembershipOpen: true,
      autoOrbitPlacement: false,
      applicationQuestions: [],
      discordUrl: "",
      xUrl: "",
      telegramUrl: "",
      githubUrl: "",
      websiteUrl: "",
    },
    mode: "onBlur",
  })

  const [membershipConfig, setMembershipConfig] = React.useState<Record<string, unknown>>({})
  const [deleteConfirm, setDeleteConfirm] = React.useState("")

  const questions = useFieldArray({
    control: form.control,
    name: "applicationQuestions"
  })

  const isLoading = sessionLoading || ctx.status === "loading"

  // Check ownership
  const isOwner = React.useMemo(() => {
    if (!sessionUser || !community) return null

    const ownerId = community.ownerId ?? ""
    const ownerHandle = community.owner?.handle ?? ""

    if (ownerId && sessionUser.id) {
      return ownerId === sessionUser.id
    }

    if (ownerHandle && sessionUser.handle) {
      return ownerHandle.trim().toLowerCase() === sessionUser.handle.trim().toLowerCase()
    }

    return null
  }, [sessionUser, community])

  // Initialize form when community data loads
  React.useEffect(() => {
    if (!community) return

    const config = typeof community.membershipConfig === "object" && community.membershipConfig !== null
      ? community.membershipConfig as Record<string, unknown>
      : {}

    setMembershipConfig(config)

    const safeQuestions = parseApplicationQuestions(config)

    form.reset(
      {
        handle: community.handle ?? "",
        name: community.name ?? "",
        description: community.description ?? "",
        avatarUrl: community.avatarUrl ?? "",
        isPublicDirectory: community.isPublicDirectory ?? true,
        isMembershipOpen: community.isMembershipOpen ?? true,
        autoOrbitPlacement: community.autoOrbitPlacement ?? false,
        applicationQuestions: safeQuestions,
        discordUrl: community.discordUrl ?? "",
        xUrl: community.xUrl ?? "",
        telegramUrl: community.telegramUrl ?? "",
        githubUrl: community.githubUrl ?? "",
        websiteUrl: community.websiteUrl ?? "",
      },
      { keepDirty: false }
    )
  }, [community, form])

  // Set community error if there is one
  React.useEffect(() => {
    if (ctx.status === "error" && ctx.errorMessage) {
      form.setError("root", { type: "server", message: ctx.errorMessage })
    }
  }, [ctx.status, ctx.errorMessage, form])

  // Permission gate — redirect users without community.update permission
  const canEditSettings = hasPermission(
    ctx.viewerMembership?.role ?? "MEMBER",
    "community.update",
    ctx.community?.permissions,
  )
  React.useEffect(() => {
    if (ctx.status === "ready" && !canEditSettings) {
      router.replace(communityPath(communityHandle))
    }
  }, [ctx.status, canEditSettings, communityHandle, router])

  async function handleSubmit(values: CommunitySettingsValues) {
    form.clearErrors("root")

    if (!community?.id) {
      form.setError("root", { type: "server", message: "Community is still loading. Try again." })
      return
    }

    const payload = {
      communityId: community.id,
      handle: values.handle.trim(),
      name: optionalString(values.name)!,
      description: optionalString(values.description) ?? null,
      avatarUrl: optionalString(values.avatarUrl) ?? null,
      isPublicDirectory: !!values.isPublicDirectory,
      isMembershipOpen: !!values.isMembershipOpen,
      autoOrbitPlacement: !!values.autoOrbitPlacement,
      membershipConfig: {
        ...membershipConfig,
        applicationQuestions: values.applicationQuestions.map((q) => ({
          id: q.id,
          label: q.label.trim(),
          type: q.type,
          required: !!q.required,
          placeholder: String(q.placeholder || "").trim(),
          help: String(q.help || "").trim(),
        })),
      },
      discordUrl: normalizeSocialUrl(values.discordUrl, "discordUrl"),
      xUrl: normalizeSocialUrl(values.xUrl, "xUrl"),
      telegramUrl: normalizeSocialUrl(values.telegramUrl, "telegramUrl"),
      githubUrl: normalizeSocialUrl(values.githubUrl, "githubUrl"),
      websiteUrl: normalizeSocialUrl(values.websiteUrl, "websiteUrl"),
    }

    const result = await apiPost<CommunityUpdateResponse>("/api/community/update", payload)

    if (result.ok) {
      // Reset form with current values so isDirty becomes false
      const cleanValues: CommunitySettingsValues = {
        handle: values.handle,
        name: values.name,
        description: values.description,
        avatarUrl: values.avatarUrl,
        isPublicDirectory: values.isPublicDirectory,
        isMembershipOpen: values.isMembershipOpen,
        autoOrbitPlacement: values.autoOrbitPlacement,
        applicationQuestions: values.applicationQuestions.map((q) => ({
          id: q.id,
          label: q.label,
          type: q.type,
          required: q.required,
          placeholder: q.placeholder,
          help: q.help,
        })),
        discordUrl: values.discordUrl,
        xUrl: values.xUrl,
        telegramUrl: values.telegramUrl,
        githubUrl: values.githubUrl,
        websiteUrl: values.websiteUrl,
      }
      form.reset(cleanValues)

      const newHandle = result.value.community.handle
      if (newHandle && newHandle !== communityHandle) {
        router.replace(communitySettingsPath(newHandle))
      }
      ctx.refetch()
      router.refresh()
      return
    }

    const err = result.error
    const parsed = parseApiError(err)

    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (key in form.getValues()) {
        form.setError(key as keyof CommunitySettingsValues, { type: "server", message })
      }
    }

    if (!parsed.formError && parsed.fieldErrors.handle) {
      // Don't show a generic root error when the handle field already shows the issue.
    } else {
      form.setError("root", {
        type: "server",
        message: parsed.formError || "We couldn't update this community. Try again.",
      })
    }
  }

  async function handleAvatarUpload(file: File): Promise<{ publicUrl: string }> {
    const fd = new FormData()
    fd.set("file", file)
    fd.set("filename", file.name)
    fd.set("contentType", file.type || "application/octet-stream")
    fd.set("size", String(file.size))
    fd.set("type", "community.avatar")
    if (community?.id) fd.set("communityId", community.id)

    const resp = await fetch("/api/upload/sign", { method: "POST", body: fd })
    const json = await resp.json().catch(() => null)

    if (!resp.ok || !json?.ok) {
      const parsed = parseApiError(json?.error ?? json)
      throw new Error(parsed.formError || "Couldn't upload avatar.")
    }

    const publicUrl =
      json.data?.publicUrl ??
      json.data?.upload?.publicUrl ??
      json.publicUrl

    if (!publicUrl) throw new Error("Upload completed but public URL is missing.")

    return { publicUrl }
  }

  function handleAvatarError(message: string) {
    form.setError("root", { type: "server", message })
  }

  function handleAddQuestion() {
    questions.append({
      id: generateQuestionId(),
      label: "",
      type: "text",
      required: false,
      placeholder: "",
      help: "",
    })
  }

  function handleDeleteClick() {
    form.setError("root", {
      type: "server",
      message: "Delete isn't wired yet. We'll add the API route + confirmation flow next.",
    })
  }

  const rootError = form.formState.errors.root?.message
  const communityName = community?.name || "Community"
  const watchedAvatarUrl = form.watch("avatarUrl")

  // Override the layout header avatar with the form-watched value
  React.useEffect(() => {
    const avatarSrc = watchedAvatarUrl || community?.avatarUrl
    if (avatarSrc) {
      ctx.setLeadingOverride(
        <ProfileAvatar type="community" src={avatarSrc} name={communityName} className="h-12 w-12" />
      )
    } else {
      ctx.setLeadingOverride(null)
    }
    return () => ctx.setLeadingOverride(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedAvatarUrl, community?.avatarUrl, communityName])

  if (!communityHandle) return null

  if (isLoading) {
    return <SettingsContentSkeleton />
  }

  return (
    <>
      <Form form={form} onSubmit={handleSubmit}>
        {rootError ? (
          <Alert variant="destructive">
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}

        <SocialLinksSection form={form} />

        <ProfileSection
          form={form}
          community={community}
          communityName={communityName}
          currentHandle={communityHandle}
          onAvatarUpload={handleAvatarUpload}
          onAvatarError={handleAvatarError}
        />

        <PrivacySection form={form} />

        <ApplicationQuestionsSection
          form={form}
          questions={questions}
          onAddQuestion={handleAddQuestion}
        />

      </Form>

      <DangerZoneSection
        deleteConfirm={deleteConfirm}
        onDeleteConfirmChange={setDeleteConfirm}
        onDeleteClick={handleDeleteClick}
      />

      <UnsavedChangesBar
        show={form.formState.isDirty}
        saving={form.formState.isSubmitting}
        onSave={() => form.handleSubmit(handleSubmit)()}
        onReset={() => form.reset()}
      />
    </>
  )
}

// === SUB-COMPONENTS ===

function ProfileSection({
  form,
  community,
  communityName,
  currentHandle,
  onAvatarUpload,
  onAvatarError,
}: {
  form: ReturnType<typeof useForm<CommunitySettingsValues>>
  community: CommunityData["community"] | null
  communityName: string
  currentHandle: string
  onAvatarUpload: (file: File) => Promise<{ publicUrl: string }>
  onAvatarError: (message: string) => void
}) {
  const watchedName = form.watch("name")
  const watchedAvatar = form.watch("avatarUrl")
  // Only fall back to the server value when the form field hasn't been touched yet.
  // Once the user explicitly clears it, watchedAvatar is "" and we must respect that.
  const avatarValue = watchedAvatar || (form.formState.dirtyFields.avatarUrl ? null : community?.avatarUrl) || null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Basic details people see on the community page.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <Field data-slot="community-settings-avatar" name="avatarUrl" invalid={!!form.formState.errors.avatarUrl}>
          <FieldLabel>Avatar</FieldLabel>
          <FieldDescription>A photo or image that represents the community across the platform.</FieldDescription>
          <div className="flex justify-center rounded-xl border border-dashed border-border p-6">
            <AvatarDropzone
              value={avatarValue}
              alt="Community avatar"
              fallbackIcon={Users}
              className="flex flex-col items-center text-center"
              upload={onAvatarUpload}
              onChange={(url) => {
                form.clearErrors("root")
                form.setValue("avatarUrl", url ?? "", { shouldDirty: true, shouldTouch: true })
              }}
              onError={onAvatarError}
              onDelete={() => {
                form.clearErrors("root")
                form.setValue("avatarUrl", "", { shouldDirty: true, shouldTouch: true })
              }}
              hasImage={!!avatarValue}
            />
          </div>

          {form.formState.errors.avatarUrl?.message && (
            <FieldError>{String(form.formState.errors.avatarUrl.message)}</FieldError>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField<CommunitySettingsValues, "handle">
            name="handle"
            label="Handle"
            required
            description="The old handle is reclaimable for a limited time."
            render={({ id, field, fieldState }) => (
              <HandleField
                id={id}
                field={field}
                fieldState={fieldState}
                nameValue={watchedName}
                currentHandle={currentHandle}
                ownerType="COMMUNITY"
                ownerId={community?.id}
              />
            )}
          />

          <FormField<CommunitySettingsValues, "name">
            name="name"
            label="Name"
            description="The name of your community or organization"
            required
            render={({ id, field, fieldState }) => (
              <Input {...fieldControlProps(field, { id, invalid: fieldState.invalid })} value={field.value ?? ""} />
            )}
            />
        </div>

        <FormField<CommunitySettingsValues, "description">
          name="description"
          label="Description"
          description="A short summary shown on the community page"
          render={({ id, field, fieldState }) => (
            <Textarea
              {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
              value={String(field.value ?? "")}
              rows={5}
            />
          )}
        />
      </CardContent>
    </Card>
  )
}

const SOCIAL_FIELDS = [
  { name: "discordUrl" as const, label: "Discord", icon: DiscordIcon, placeholder: "invite-code or discord.gg/..." },
  { name: "xUrl" as const, label: "X", icon: XIcon, placeholder: "handle" },
  { name: "githubUrl" as const, label: "GitHub", icon: GitHubIcon, placeholder: "org or user" },
  { name: "telegramUrl" as const, label: "Telegram", icon: TelegramIcon, placeholder: "handle" },
  { name: "websiteUrl" as const, label: "Website", icon: Globe, placeholder: "example.com" },
] as const

function SocialLinksSection({ form }: { form: ReturnType<typeof useForm<CommunitySettingsValues>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Social accounts</CardTitle>
        <CardDescription>Add links so members can find your community elsewhere.</CardDescription>
      </CardHeader>
      <CardContent className="px-5 grid gap-4 sm:grid-cols-2">
        {SOCIAL_FIELDS.map(({ name, label, icon: Icon, placeholder }) => (
          <div key={name} className="rounded-lg border border-border/60 p-3 text-sm">
            <h2 className="text-xs font-medium text-muted-foreground mb-2">{label}</h2>
            <div className="flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <FormField<CommunitySettingsValues, typeof name>
                className="w-full"
                name={name}
                render={({ id, field, fieldState }) => (
                  <Input
                    {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                    placeholder={placeholder}
                    className="h-8 text-sm"
                  />
                )}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function PrivacySection({ form }: { form: ReturnType<typeof useForm<CommunitySettingsValues>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy & access</CardTitle>
        <CardDescription>Control what non-members can see and whether applications are allowed.</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormField<CommunitySettingsValues, "isPublicDirectory">
          name="isPublicDirectory"
          render={({ id, field }) => (
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 p-4">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium">Public directory</div>
                <div className="text-xs text-muted-foreground">
                  If off, only approved members can see the member directory.
                </div>
              </div>
              <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />

        <FormField<CommunitySettingsValues, "isMembershipOpen">
          name="isMembershipOpen"
          render={({ id, field }) => (
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 p-4">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium">Accepting applications</div>
                <div className="text-xs text-muted-foreground">If off, hide apply and treat as closed.</div>
              </div>
              <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />

        <FormField<CommunitySettingsValues, "autoOrbitPlacement">
          name="autoOrbitPlacement"
          render={({ id, field }) => (
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 p-4 sm:col-span-2">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium">Auto orbit placement</div>
                <div className="text-xs text-muted-foreground">
                  If on, members move between orbits automatically based on their gravity score.
                  If off, admins place members manually. Scores are always calculated either way.
                </div>
              </div>
              <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}

function ApplicationQuestionsSection({
  form,
  questions,
  onAddQuestion,
}: {
  form: ReturnType<typeof useForm<CommunitySettingsValues>>
  questions: ReturnType<typeof useFieldArray<CommunitySettingsValues, "applicationQuestions">>
  onAddQuestion: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Join questions</CardTitle>
        <CardDescription>These questions appear on the join page when membership is open. Keep them short and focused.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {questions.fields.length > 0 ? (
          <div className="flex flex-col gap-4">
            {questions.fields.map((q, index) => (
              <QuestionField
                key={q.id}
                form={form}
                index={index}
                questions={questions}
              />
            ))}
          </div>
        ) : (
          <Alert>
            <AlertDescription>No join questions yet.</AlertDescription>
          </Alert>
        )}

        <div>
          <Button type="button" onClick={onAddQuestion}>
            Add question
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function QuestionField({
  form,
  index,
  questions,
}: {
  form: ReturnType<typeof useForm<CommunitySettingsValues>>
  index: number
  questions: ReturnType<typeof useFieldArray<CommunitySettingsValues, "applicationQuestions">>
}) {
  const base = `applicationQuestions.${index}` as const
  const errors = form.formState.errors.applicationQuestions?.[index]

  return (
    <div className="rounded-2xl border border-border/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Question {index + 1}</div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-3"
            disabled={index === 0}
            onClick={() => questions.move(index, index - 1)}
          >
            Up
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-3"
            disabled={index === questions.fields.length - 1}
            onClick={() => questions.move(index, index + 1)}
          >
            Down
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-8 px-3"
            onClick={() => questions.remove(index)}
          >
            Remove
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <Field name={`${base}.label`} invalid={!!errors?.label}>
          <FieldLabel>Prompt</FieldLabel>
          <FieldDescription>What do you want applicants to answer?</FieldDescription>
          <Input
            {...form.register(`${base}.label` as const)}
            placeholder="e.g. What are you building?"
            aria-invalid={!!errors?.label}
          />
          {errors?.label?.message && <FieldError>{String(errors.label.message)}</FieldError>}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField<CommunitySettingsValues, `applicationQuestions.${number}.type`>
            name={`applicationQuestions.${index}.type`}
            label="Answer type"
            description="Short or long answer."
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={field.value === "text" ? "default" : "secondary"}
                  className="h-9"
                  onClick={() => field.onChange("text")}
                >
                  Short
                </Button>
                <Button
                  type="button"
                  variant={field.value === "textarea" ? "default" : "secondary"}
                  className="h-9"
                  onClick={() => field.onChange("textarea")}
                >
                  Long
                </Button>
              </div>
            )}
          />

          <FormField<CommunitySettingsValues, `applicationQuestions.${number}.required`>
            name={`applicationQuestions.${index}.required`}
            label="Required"
            description="If on, applicants can't submit without answering."
            render={({ id, field }) => (
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 p-4">
                <div className="text-sm font-medium">Required</div>
                <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />
              </div>
            )}
          />
        </div>

        <Field name={`${base}.placeholder`} invalid={!!errors?.placeholder}>
          <FieldLabel>Placeholder</FieldLabel>
          <FieldDescription>Optional hint shown inside the input.</FieldDescription>
          <Input
            {...form.register(`${base}.placeholder` as const)}
            placeholder="e.g. A few sentences is fine…"
            aria-invalid={!!errors?.placeholder}
          />
          {errors?.placeholder?.message && <FieldError>{String(errors.placeholder.message)}</FieldError>}
        </Field>

        <Field name={`${base}.help`} invalid={!!errors?.help}>
          <FieldLabel>Help text</FieldLabel>
          <FieldDescription>Optional context shown below the prompt on the apply page.</FieldDescription>
          <Textarea {...form.register(`${base}.help` as const)} aria-invalid={!!errors?.help} rows={2} />
          {errors?.help?.message && <FieldError>{String(errors.help.message)}</FieldError>}
        </Field>
      </div>
    </div>
  )
}

function DangerZoneSection({
  deleteConfirm,
  onDeleteConfirmChange,
  onDeleteClick,
}: {
  deleteConfirm: string
  onDeleteConfirmChange: (value: string) => void
  onDeleteClick: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>Destructive actions. More actions can be wired later.</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">Delete community</div>
            <div className="text-xs text-muted-foreground">
              This is permanent. Type <span className="font-medium">DELETE</span> to enable the button.
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Input
              placeholder="Type DELETE"
              value={deleteConfirm}
              onChange={(e) => onDeleteConfirmChange(e.target.value)}
              aria-invalid={false}
            />

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                Delete isn&apos;t wired yet — this will be hooked to an API route with an extra confirmation step.
              </div>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteConfirm.trim() !== "DELETE"}
                onClick={onDeleteClick}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
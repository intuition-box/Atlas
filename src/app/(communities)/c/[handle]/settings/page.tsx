"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useParams, useRouter } from "next/navigation"
import { getSession } from "next-auth/react"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { PageHeader } from "@/components/common/page-header"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Form, FormActions, FormField, FormMessage, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { useFieldArray } from "react-hook-form"
import { UsersIcon } from "@/components/ui/icons"

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
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  description: z.string().max(2000, "Description is too long"),
  avatarUrl: z.string().url("Enter a valid image URL").optional().or(z.literal("")),
  isPublicDirectory: z.boolean(),
  isMembershipOpen: z.boolean(),
  applicationQuestions: z.array(ApplicationQuestionSchema),
})

type CommunitySettingsValues = z.infer<typeof CommunitySettingsSchema>

// === API TYPES ===

type CommunityGetResponse = {
  community: {
    id: string
    handle: string
    name: string
    description?: string | null
    avatarUrl?: string | null
    isPublicDirectory?: boolean | null
    isMembershipOpen?: boolean | null
    ownerId?: string | null
    owner?: { handle?: string | null } | null
    membershipConfig?: unknown
  }
}

type CommunityUpdateResponse = {
  community: {
    handle: string
  }
}

type UploadSignResponse = {
  upload: { uploadUrl: string; publicUrl: string; key: string }
}

// === UTILITY FUNCTIONS ===

function generateQuestionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `q_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function normalizeHandle(value: unknown): string {
  return String(value ?? "").trim().toLowerCase()
}

function optionalString(value: string | undefined | null): string | undefined {
  const trimmed = String(value ?? "").trim()
  return trimmed || undefined
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

function useCommunityData(handle: string) {
  const [community, setCommunity] = React.useState<CommunityGetResponse["community"] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    if (!handle) {
      setLoading(false)
      return
    }

    apiGet<CommunityGetResponse>("/api/community/get", { handle })
      .then((res) => {
        if (cancelled) return

        if (!res.ok) {
          const err = res.error
          const parsed = parseApiError(err)
          setError(parsed.formError || "We couldn't load this community. Try again.")
          setLoading(false)
          return
        }

        setCommunity(res.value.community)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError("An unexpected error occurred while loading the community.")
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [handle])

  return { community, loading, error }
}

// === COMPONENT ===

export default function CommunitySettingsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const communityHandle = String(params?.handle || "")

  const { user: sessionUser, loading: sessionLoading } = useSessionUser()
  const { community, loading: communityLoading, error: communityError } = useCommunityData(communityHandle)

  const form = useForm<CommunitySettingsValues>({
    resolver: zodResolver(CommunitySettingsSchema),
    defaultValues: {
      name: "",
      description: "",
      avatarUrl: "",
      isPublicDirectory: true,
      isMembershipOpen: true,
      applicationQuestions: [],
    },
    mode: "onBlur",
  })

  const [membershipConfig, setMembershipConfig] = React.useState<Record<string, unknown>>({})
  const [deleteConfirm, setDeleteConfirm] = React.useState("")

  const questions = useFieldArray({
    control: form.control,
    name: "applicationQuestions"
  })

  const isLoading = sessionLoading || communityLoading

  // Check ownership
  const isOwner = React.useMemo(() => {
    if (!sessionUser || !community) return null

    const ownerId = community.ownerId ?? ""
    const ownerHandle = community.owner?.handle ?? ""

    if (ownerId && sessionUser.id) {
      return ownerId === sessionUser.id
    }

    if (ownerHandle && sessionUser.handle) {
      return normalizeHandle(ownerHandle) === normalizeHandle(sessionUser.handle)
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
        name: community.name ?? "",
        description: community.description ?? "",
        avatarUrl: community.avatarUrl ?? "",
        isPublicDirectory: community.isPublicDirectory ?? true,
        isMembershipOpen: community.isMembershipOpen ?? true,
        applicationQuestions: safeQuestions,
      },
      { keepDirty: false }
    )
  }, [community, form])

  // Set community error if there is one
  React.useEffect(() => {
    if (communityError) {
      form.setError("root", { type: "server", message: communityError })
    }
  }, [communityError, form])

  async function handleSubmit(values: CommunitySettingsValues) {
    form.clearErrors("root")

    if (!community?.id) {
      form.setError("root", { type: "server", message: "Community is still loading. Try again." })
      return
    }

    const payload = {
      communityId: community.id,
      name: optionalString(values.name)!,
      description: optionalString(values.description) ?? null,
      avatarUrl: optionalString(values.avatarUrl) ?? null,
      isPublicDirectory: !!values.isPublicDirectory,
      isMembershipOpen: !!values.isMembershipOpen,
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
    }

    const result = await apiPost<CommunityUpdateResponse>("/api/community/update", payload)

    if (result.ok) {
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

    form.setError("root", {
      type: "server",
      message: parsed.formError || "We couldn't update this community. Try again.",
    })
  }

  async function handleAvatarSign(file: File) {
    const signed = await apiPost<UploadSignResponse>("/api/upload/sign", {
      type: "community.avatar",
      contentType: file.type,
      size: file.size,
    })

    if (!signed.ok) {
      const err = signed.error
      const parsed = parseApiError(err)
      throw new Error(parsed.formError || "Couldn't upload avatar.")
    }

    return {
      uploadUrl: signed.value.upload.uploadUrl,
      publicUrl: signed.value.upload.publicUrl,
    }
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

  if (!communityHandle) return null

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Form form={form} onSubmit={handleSubmit} className="flex flex-col gap-10">
        <PageHeader
          leading={
            <Avatar className="h-12 w-12">
              <AvatarImage src={community?.avatarUrl ?? undefined} alt={communityName} />
              <AvatarFallback><UsersIcon /></AvatarFallback>
            </Avatar>
          }
          title="Settings"
          description={`/c/${communityHandle}`}
          actions={
            <FormActions className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={() => router.replace(`/c/${communityHandle}`)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || !community || form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save changes"}
              </Button>
            </FormActions>
          }
        />

        {rootError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <FormMessage className="text-destructive">{rootError}</FormMessage>
          </div>
        )}

        <ProfileSection
          form={form}
          community={community}
          communityName={communityName}
          communityHandle={communityHandle}
          onAvatarSign={handleAvatarSign}
          onAvatarError={handleAvatarError}
        />

        <PrivacySection form={form} />

        <ApplicationQuestionsSection
          form={form}
          questions={questions}
          onAddQuestion={handleAddQuestion}
        />

        <DangerZoneSection
          deleteConfirm={deleteConfirm}
          onDeleteConfirmChange={setDeleteConfirm}
          onDeleteClick={handleDeleteClick}
        />
      </Form>
    </main>
  )
}

// === SUB-COMPONENTS ===

function ProfileSection({
  form,
  community,
  communityName,
  communityHandle,
  onAvatarSign,
  onAvatarError,
}: {
  form: ReturnType<typeof useForm<CommunitySettingsValues>>
  community: CommunityGetResponse["community"] | null
  communityName: string
  communityHandle: string
  onAvatarSign: (file: File) => Promise<{ uploadUrl: string; publicUrl: string }>
  onAvatarError: (message: string) => void
}) {
  const avatarFallback = String(form.watch("name") || communityName || "?").slice(0, 1).toUpperCase()

  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium text-foreground/80">Profile</h2>
      <p className="mt-1 text-xs text-muted-foreground">Basic details people see on the community page.</p>

      <div className="mt-4 flex flex-col gap-6">
        <Field data-slot="community-settings-avatar" name="avatarUrl" invalid={!!form.formState.errors.avatarUrl}>
          <FieldLabel>Avatar</FieldLabel>
          <FieldDescription>Drop an image on the avatar to replace it.</FieldDescription>

          <AvatarDropzone
            value={String(form.watch("avatarUrl") || "") || null}
            alt="Community avatar"
            fallback={avatarFallback}
            onChange={(url) => {
              form.clearErrors("root")
              form.setValue("avatarUrl", url ?? "", { shouldDirty: true, shouldTouch: true })
            }}
            sign={onAvatarSign}
            onError={onAvatarError}
          />

          {form.formState.errors.avatarUrl?.message && (
            <FieldError>{String(form.formState.errors.avatarUrl.message)}</FieldError>
          )}
        </Field>

        <div className="grid gap-4">
          <div className="rounded-lg border border-border/60 p-3">
            <div className="text-xs font-medium text-foreground/70">Handle</div>
            <div className="mt-1 text-sm text-foreground/80">/c/{communityHandle}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              Handle renaming can be added later.
              <span className="block mt-1">
                When we support changing it: the old URL should return 404 immediately (no redirects), and the old
                handle may be reclaimable for a limited time.
              </span>
            </div>
          </div>
        </div>

        <FormField<CommunitySettingsValues, "name">
          name="name"
          label="Name"
          required
          render={({ id, field, fieldState }) => (
            <Input {...fieldControlProps(field, { id, invalid: fieldState.invalid })} value={field.value ?? ""} />
          )}
        />

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
      </div>
    </section>
  )
}

function PrivacySection({ form }: { form: ReturnType<typeof useForm<CommunitySettingsValues>> }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium text-foreground/80">Privacy & access</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Control what non-members can see and whether applications are allowed.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <FormField<CommunitySettingsValues, "isPublicDirectory">
          name="isPublicDirectory"
          label="Public directory"
          description="If off, only approved members can see the member directory. Non-members see a splash + apply CTA."
          render={({ id, field }) => (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 p-4">
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
          label="Accepting applications"
          description="If off, non-members won't see the apply CTA (and we may 404 to avoid leaking closed spaces)."
          render={({ id, field }) => (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 p-4">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium">Accepting applications</div>
                <div className="text-xs text-muted-foreground">If off, hide apply and treat as closed.</div>
              </div>
              <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />
      </div>
    </section>
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
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium text-foreground/80">Application questions</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        These questions appear on the apply page when applications are open. Keep them short and focused.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {questions.fields.length > 0 ? (
          <div className="flex flex-col gap-3">
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
          <div className="rounded-2xl border border-border/60 p-4 text-sm text-muted-foreground">
            No application questions yet.
          </div>
        )}

        <div>
          <Button type="button" variant="secondary" onClick={onAddQuestion}>
            + Add question
          </Button>
        </div>
      </div>
    </section>
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
  const currentType = String(form.watch(`${base}.type` as const) || "text")

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
          <Field name={`${base}.type`} invalid={false}>
            <FieldLabel>Answer type</FieldLabel>
            <FieldDescription>Short or long answer.</FieldDescription>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={currentType === "text" ? "default" : "secondary"}
                className="h-9"
                onClick={() => form.setValue(`${base}.type` as const, "text", { shouldDirty: true })}
              >
                Short
              </Button>
              <Button
                type="button"
                variant={currentType === "textarea" ? "default" : "secondary"}
                className="h-9"
                onClick={() => form.setValue(`${base}.type` as const, "textarea", { shouldDirty: true })}
              >
                Long
              </Button>
            </div>
          </Field>

          <Field name={`${base}.required`} invalid={false}>
            <FieldLabel>Required</FieldLabel>
            <FieldDescription>If on, applicants can't submit without answering.</FieldDescription>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 p-4">
              <div className="text-sm font-medium">Required</div>
              <Switch
                checked={!!form.watch(`${base}.required` as const)}
                onCheckedChange={(v) => form.setValue(`${base}.required` as const, !!v, { shouldDirty: true })}
              />
            </div>
          </Field>
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
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium text-foreground/80">Danger zone</h2>
      <p className="mt-1 text-xs text-muted-foreground">Destructive actions. More actions can be wired later.</p>

      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
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
              Delete isn't wired yet — this will be hooked to an API route with an extra confirmation step.
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
    </section>
  )
}
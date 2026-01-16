"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

import { apiPost } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"
import { makeHandleCandidate, normalizeHandle, validateHandle } from "@/lib/handle"
import { ROUTES } from "@/lib/routes"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { Button } from "@/components/ui/button"
import { Form, FormActions, FormField, FormMessage, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

const FormSchema = z.object({
  name: z.string().trim().min(1, "Community name is required").max(120, "Name is too long"),
  handle: z
    .string()
    .trim()
    .min(1, "Handle is required")
    // rely on server for full validation; we normalize for UX
    .max(32, "Handle is too long"),
  description: z.string().trim().max(1000, "Description is too long").optional(),
  avatarUrl: z.string().trim().url("Enter a valid URL").optional().or(z.literal("")),
  isMembershipOpen: z.boolean(),
  isPublicDirectory: z.boolean(),
  // Advanced: JSON as text; parsed on submit.
  membershipConfig: z.string().trim().optional(),
  orbitConfig: z.string().trim().optional(),
})

type FormValues = z.infer<typeof FormSchema>

type CreateCommunityResponse = {
  community: {
    id: string
    handle: string
  }
}

function opt(value: string | undefined | null) {
  const v = String(value ?? "").trim()
  return v ? v : undefined
}

function parseJsonOrUndefined(input: string | undefined | null) {
  const raw = String(input ?? "").trim()
  if (!raw) return undefined

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return { __invalidJson: true }
  }
}

function withReturnTo(path: string, returnToUrl: string) {
  const sep = path.includes("?") ? "&" : "?"
  return `${path}${sep}returnToUrl=${encodeURIComponent(returnToUrl)}`
}

export default function NewCommunityPage() {
  const router = useRouter()

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      handle: "",
      description: "",
      avatarUrl: "",
      isMembershipOpen: true,
      isPublicDirectory: true,
      membershipConfig: "",
      orbitConfig: "",
    },
    mode: "onBlur",
  })

  const watchedHandle = form.watch("handle")
  const watchedName = form.watch("name")
  const watchedAvatarUrl = form.watch("avatarUrl")

  const normalizedHandle = watchedHandle && watchedHandle.trim() ? normalizeHandle(watchedHandle) : ""

  function applySuggestion() {
    if (String(form.getValues("handle") || "").trim()) return

    const suggested = makeHandleCandidate(watchedName || "")
    if (suggested) {
      form.setValue("handle", suggested, { shouldDirty: true, shouldTouch: true })
      form.clearErrors("handle")
    }
  }

  const handlePreview = React.useMemo(() => normalizeHandle(watchedHandle || ""), [watchedHandle])

  async function onSubmit(values: FormValues) {
    form.clearErrors("root")

    const handleCheck = validateHandle(values.handle)
    if (!handleCheck.ok) {
      form.setError("handle", { type: "validate", message: handleCheck.error.message })
      return
    }

    const membershipConfig = parseJsonOrUndefined(values.membershipConfig)
    if (membershipConfig && typeof membershipConfig === "object" && "__invalidJson" in membershipConfig) {
      form.setError("membershipConfig", { type: "validate", message: "Invalid JSON" })
      return
    }

    const orbitConfig = parseJsonOrUndefined(values.orbitConfig)
    if (orbitConfig && typeof orbitConfig === "object" && "__invalidJson" in orbitConfig) {
      form.setError("orbitConfig", { type: "validate", message: "Invalid JSON" })
      return
    }

    const payload = {
      name: values.name.trim(),
      handle: handleCheck.value,
      description: opt(values.description) ?? null,
      avatarUrl: opt(values.avatarUrl) ?? null,
      isMembershipOpen: values.isMembershipOpen,
      isPublicDirectory: values.isPublicDirectory,
      membershipConfig: membershipConfig ?? null,
      orbitConfig: orbitConfig ?? null,
    }

    const result = await apiPost<CreateCommunityResponse>("/api/community/create", payload)

    if (result.ok) {
      router.push(`/c/${result.value.community.handle}`)
      return
    }

    // Api-client returns either an ApiProblem-like error or an ApiClientError.
    if (result.error && typeof result.error === "object" && "status" in result.error) {
      const parsed = parseApiProblem(result.error)

      // Auth/onboarding flows (layout should usually handle this, but keep UX tight).
      const returnTo = ROUTES.communityNew ?? "/new"
      if (parsed.status === 401) {
        router.push(withReturnTo(ROUTES.signIn, returnTo))
        return
      }
      if (parsed.status === 428) {
        router.push(withReturnTo(ROUTES.onboarding, returnTo))
        return
      }

      if (parsed.fieldErrors) {
        for (const [key, message] of Object.entries(parsed.fieldErrors)) {
          if (key === "name" || key === "handle" || key === "description" || key === "avatarUrl") {
            form.setError(key as any, { type: "server", message: String(message) })
          }
        }
      }

      form.setError("root", { type: "server", message: parsed.formError || "Couldn’t create community." })
      return
    }

    const parsed = parseApiClientError(result.error)
    form.setError("root", { type: "server", message: parsed.formError || "Couldn’t create community." })
  }

  const canSubmit = !form.formState.isSubmitting

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create community</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pick a name and handle. You can change most settings later.
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Back
        </Button>
      </header>

      <Form form={form} onSubmit={onSubmit} className="mt-8">
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-4">
            <AvatarDropzone
              value={watchedAvatarUrl || null}
              alt={watchedName || "Community"}
              fallback={(watchedName?.trim()?.slice(0, 1) || "C").toUpperCase()}
              onChange={(url) => {
                form.clearErrors("root")
                form.setValue("avatarUrl", url ?? "", { shouldDirty: true, shouldTouch: true })
              }}
              sign={async (file) => {
                const signed = await apiPost<any>("/api/upload/sign", {
                  type: "community.avatar",
                  contentType: file.type,
                  size: file.size,
                })

                if (!signed.ok) {
                  const err = signed.error
                  const parsed = err && typeof err === "object" && "status" in err
                    ? parseApiProblem(err as any)
                    : parseApiClientError(err as any)
                  throw new Error(parsed.formError || "Couldn’t upload avatar.")
                }

                const upload = (signed.value as any).upload ?? signed.value
                if (!upload?.uploadUrl || !upload?.publicUrl) {
                  throw new Error("Upload response was invalid.")
                }

                return { uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl }
              }}
              onError={(message) => {
                form.setError("root", { type: "server", message })
              }}
            />

            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Preview</div>
              <div className="text-muted-foreground mt-1 text-sm">
                {watchedName?.trim() ? watchedName.trim() : "Community name"}
                {handlePreview ? <span className="text-muted-foreground"> · c/{handlePreview}</span> : null}
              </div>
            </div>
          </div>

          <FormField<FormValues, "name">
            name="name"
            label="Name"
            description="The display name people see on the directory and your pages."
            render={({ id, field, fieldState }) => (
              <Input
                placeholder="e.g. Orbit Builders"
                {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                value={field.value ?? ""}
              />
            )}
          />

          <FormField<FormValues, "handle">
            name="handle"
            label="Handle"
            required
            description={
              <>
                <span>Your username often used in social networks.</span>
                {watchedHandle.trim() && normalizedHandle && normalizedHandle !== watchedHandle.trim() ? (
                  <span className="block">Will be saved as {normalizedHandle}</span>
                ) : null}
              </>
            }
            render={({ id, field, fieldState }) => (
              <div className="flex flex-col gap-2">
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                  value={field.value ?? ""}
                />
                {!String(field.value || "").trim() && String(watchedName || "").trim() ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-4 self-start"
                    onClick={applySuggestion}
                  >
                    Suggest from name
                  </button>
                ) : null}
              </div>
            )}
          />

          <FormField<FormValues, "description">
            name="description"
            label="Description"
            description="A short description shown on the community page."
            render={({ id, field, fieldState }) => (
              <Textarea
                id={id}
                data-slot="community-description"
                rows={4}
                value={String(field.value ?? "")}
                onChange={(e) => field.onChange(e.target.value)}
                aria-invalid={fieldState.invalid}
                placeholder="What is this community for?"
              />
            )}
          />


          <div className="rounded-2xl border border-border p-4">
            <div className="text-sm font-medium">Access</div>
            <p className="text-muted-foreground mt-1 text-sm">
              These settings control whether people can find your directory and whether applications are open.
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <FormField<FormValues, "isPublicDirectory">
                name="isPublicDirectory"
                label="Public directory"
                description="If enabled, anyone can view your member orbit."
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm">Visible to everyone</div>
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={(v) => field.onChange(Boolean(v))}
                      data-slot="community-public-directory"
                    />
                  </div>
                )}
              />

              <FormField<FormValues, "isMembershipOpen">
                name="isMembershipOpen"
                label="Accept applications"
                description="If disabled, new users can’t apply to join."
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm">Applications open</div>
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={(v) => field.onChange(Boolean(v))}
                      data-slot="community-membership-open"
                    />
                  </div>
                )}
              />
            </div>
          </div>

          {form.formState.errors.root?.message ? (
            <FormMessage className="text-destructive">{String(form.formState.errors.root.message)}</FormMessage>
          ) : null}

          <FormActions>
            <Button type="submit" disabled={!canSubmit}>
              {form.formState.isSubmitting ? "Creating…" : "Create community"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
          </FormActions>
        </div>
      </Form>
    </main>
  )
}

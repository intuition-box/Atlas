"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

import { apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { err, ok } from "@/lib/api/shapes"
import { normalizeHandle, validateHandle } from "@/lib/handle"
import { ROUTES, communityPath } from "@/lib/routes"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { HandleField } from "@/components/common/handle-field"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Form, FormActions, FormField, FormMessage, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

const FormSchema = z.object({
  // Step 1
  name: z.string().trim().min(1, "Community name is required").max(120, "Name is too long"),
  handle: z
    .string()
    .trim()
    .min(1, "Handle is required")
    // rely on server for full validation; we normalize for UX
    .max(32, "Handle is too long"),
  description: z.string().trim().max(1000, "Description is too long").optional(),

  // Step 2
  avatarUrl: z.string().trim().url("Enter a valid URL").optional().or(z.literal("")),
  isMembershipOpen: z.boolean(),
  isPublicDirectory: z.boolean(),
  // Advanced: JSON as text; parsed on submit.
  membershipConfig: z.string().trim().optional(),
  orbitConfig: z.string().trim().optional(),

  // Step 3 (UI only for now)
  invitees: z.string().trim().optional(),
})

type FormValues = z.infer<typeof FormSchema>

type CreateCommunityResponse = {
  community: {
    id: string
    handle: string
  }
}

type UploadSignResponse = {
  upload: {
    uploadUrl: string
    publicUrl: string
  }
}

type CreatedCommunity = {
  id: string
  handle: string
}

type UpdateCommunityResponse = {
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
      invitees: "",
    },
    mode: "onBlur",
  })

  const watchedHandle = form.watch("handle")
  const watchedName = form.watch("name")
  const watchedAvatarUrl = form.watch("avatarUrl")

  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [created, setCreated] = React.useState<CreatedCommunity | null>(null)

  const STEPS: Record<1 | 2 | 3, { title: string; description: string }> = {
    1: { title: "Basics", description: "Name, handle, and a short description." },
    2: { title: "Avatar & access", description: "Add an avatar and choose visibility settings." },
    3: { title: "Invite", description: "Optionally invite members now (you can do this later)." },
  }

  const stepTitle = STEPS[step].title
  const stepDescription = STEPS[step].description

  const STEP_FIELDS: Record<1 | 2 | 3, Array<keyof FormValues>> = {
    1: ["name", "handle", "description"],
    2: ["avatarUrl", "isMembershipOpen", "isPublicDirectory", "membershipConfig", "orbitConfig"],
    3: ["invitees"],
  }

  function buildCreatePayload(values: Pick<FormValues, "name" | "handle" | "description">) {
    const handleCheck = validateHandle(values.handle)
    if (!handleCheck.ok) {
      return err(handleCheck.error)
    }

    return ok({
      name: values.name.trim(),
      handle: handleCheck.value,
      description: opt(values.description) ?? null,
      // Create without avatar; we can update after upload.
      avatarUrl: null as string | null,
      // Sensible defaults until Step 2 is completed.
      isMembershipOpen: true,
      isPublicDirectory: true,
      membershipConfig: null as unknown,
      orbitConfig: null as unknown,
    })
  }

  function buildUpdatePayload(values: FormValues) {
    const membershipConfig = parseJsonOrUndefined(values.membershipConfig)
    if (membershipConfig && typeof membershipConfig === "object" && "__invalidJson" in membershipConfig) {
      return err(new Error("Invalid JSON (membershipConfig)"))
    }

    const orbitConfig = parseJsonOrUndefined(values.orbitConfig)
    if (orbitConfig && typeof orbitConfig === "object" && "__invalidJson" in orbitConfig) {
      return err(new Error("Invalid JSON (orbitConfig)"))
    }

    return ok({
      avatarUrl: opt(values.avatarUrl) ?? null,
      isMembershipOpen: values.isMembershipOpen,
      isPublicDirectory: values.isPublicDirectory,
      membershipConfig: membershipConfig ?? null,
      orbitConfig: orbitConfig ?? null,
    })
  }

  async function updateCommunity(values: FormValues) {
    if (!created) return ok(null)

    const upd = buildUpdatePayload(values)
    if (!upd.ok) return err(upd.error)

    // NOTE: this expects an existing update route (used by settings too).
    const result = await apiPost<UpdateCommunityResponse>("/api/community/update", {
      communityId: created.id,
      ...upd.value,
    })

    if (result.ok) {
      // Keep handle in sync in case server normalizes it.
      setCreated({ id: result.value.community.id, handle: result.value.community.handle })
      return ok(null)
    }

    if (result.error && typeof result.error === "object" && "status" in result.error) {
      const parsed = parseApiError(result.error)

      const returnTo = ROUTES.communityNew ?? "/new"
      if (parsed.status === 401) {
        router.push(withReturnTo(ROUTES.signIn, returnTo))
        return ok(null)
      }
      if (parsed.status === 428) {
        router.push(withReturnTo(ROUTES.onboarding, returnTo))
        return ok(null)
      }

      if (parsed.fieldErrors) {
        for (const [key, message] of Object.entries(parsed.fieldErrors)) {
          if (
            key === "avatarUrl" ||
            key === "isMembershipOpen" ||
            key === "isPublicDirectory" ||
            key === "membershipConfig" ||
            key === "orbitConfig"
          ) {
            form.setError(key as any, { type: "server", message: String(message) })
          }
        }
      }

      form.setError("root", { type: "server", message: parsed.formError || "Couldn't save community settings." })
      return ok(null)
    }

    const parsed = parseApiError(result.error)
    form.setError("root", { type: "server", message: parsed.formError || "Couldn't save community settings." })
    return ok(null)
  }

  async function goNext() {
    form.clearErrors("root")

    if (step === 1) {
      const okStep = await form.trigger(STEP_FIELDS[1] as any)
      if (!okStep) return

      const createdPayload = buildCreatePayload({
        name: form.getValues("name"),
        handle: form.getValues("handle"),
        description: form.getValues("description"),
      })

      if (!createdPayload.ok) {
        form.setError("handle", { type: "validate", message: createdPayload.error.message })
        return
      }

      // Create now so we have an ID for avatar uploads.
      const result = await apiPost<CreateCommunityResponse>("/api/community/create", createdPayload.value)

      if (result.ok) {
        setCreated({ id: result.value.community.id, handle: result.value.community.handle })
        setStep(2)
        return
      }

      if (result.error && typeof result.error === "object" && "status" in result.error) {
        const parsed = parseApiError(result.error)
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
            if (key === "name" || key === "handle" || key === "description") {
              form.setError(key as any, { type: "server", message: String(message) })
            }
          }
        }

        form.setError("root", { type: "server", message: parsed.formError || "Couldn't create community." })
        return
      }

      const parsed = parseApiError(result.error)
      form.setError("root", { type: "server", message: parsed.formError || "Couldn't create community." })
      return
    }

    if (step === 2) {
      const okStep = await form.trigger(STEP_FIELDS[2] as any)
      if (!okStep) return

      // Persist settings + avatarUrl (if present) before moving on.
      await updateCommunity(form.getValues())

      setStep(3)
      return
    }
  }

  function goBack() {
    setStep((s) => (s === 1 ? 1 : ((s - 1) as 1 | 2 | 3)))
  }

  const handlePreview = React.useMemo(() => normalizeHandle(watchedHandle || ""), [watchedHandle])

  async function onSubmit(values: FormValues) {
    form.clearErrors("root")

    // In the normal flow, Step 1 already created the community.
    if (created) {
      const saved = await updateCommunity(values)
      if (!saved.ok) {
        // buildUpdatePayload handles JSON validation; updateCommunity sets form errors.
        return
      }

      router.push(communityPath(created.handle))
      return
    }

    // Fallback: if the user somehow submits without Step 1, create with full payload.
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
      router.push(communityPath(result.value.community.handle))
      return
    }

    if (result.error && typeof result.error === "object" && "status" in result.error) {
      const parsed = parseApiError(result.error)
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

      form.setError("root", { type: "server", message: parsed.formError || "Couldn't create community." })
      return
    }

    const parsed = parseApiError(result.error)
    form.setError("root", { type: "server", message: parsed.formError || "Couldn't create community." })
  }

  const canSubmit = step === 3 && !form.formState.isSubmitting

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Form form={form} onSubmit={onSubmit} className="mt-0">
        <PageHeader
          title="Create community"
          description={stepDescription}
          actions={
            <FormActions>
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Cancel
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={goBack}
                className={step > 1 ? "" : "hidden"}
              >
                Back
              </Button>

              <Button
                type={step < 3 ? "button" : "submit"}
                onClick={step < 3 ? goNext : undefined}
                disabled={step === 3 ? !canSubmit : false}
              >
                {step < 3 ? "Next" : form.formState.isSubmitting ? "Creating…" : "Create community"}
              </Button>
            </FormActions>
          }
        />

        <div className="mt-8 flex flex-col gap-6">
          <div className="text-muted-foreground text-sm">Step {step} of 3 · {stepTitle}</div>

          {step === 1 ? (
            <>
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
                description="A short, URL-friendly identifier for your community."
                render={({ id, field, fieldState }) => (
                  <HandleField
                    id={id}
                    field={field}
                    fieldState={fieldState}
                    nameValue={watchedName}
                    ownerType="COMMUNITY"
                  />
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
            </>
          ) : null}

          {step === 2 ? (
            <>
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
                    if (!created?.id) {
                      throw new Error("Create the community first before uploading an avatar.")
                    }
                    const signed = await apiPost<UploadSignResponse>("/api/upload/sign", {
                      type: "community.avatar",
                      communityId: created?.id ?? null,
                      contentType: file.type,
                      size: file.size,
                    })

                    if (!signed.ok) {
                      const err = signed.error
                      const parsed = parseApiError(err)
                      throw new Error(parsed.formError || "Couldn’t upload avatar.")
                    }

                    const upload = signed.value.upload
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
            </>
          ) : null}

          {step === 3 ? (
            <>
              <FormField<FormValues, "invitees">
                name="invitees"
                label="Invite members"
                description="Optional. Paste emails (comma-separated) or leave empty for now."
                render={({ id, field, fieldState }) => (
                  <Textarea
                    id={id}
                    rows={4}
                    value={String(field.value ?? "")}
                    onChange={(e) => field.onChange(e.target.value)}
                    aria-invalid={fieldState.invalid}
                    placeholder="alex@example.com, sam@example.com"
                  />
                )}
              />

              <div className="rounded-2xl border border-border p-4">
                <div className="text-sm font-medium">What happens next</div>
                <p className="text-muted-foreground mt-1 text-sm">
                  You can invite people later from your community settings. This step doesn’t send invites yet.
                </p>
              </div>
            </>
          ) : null}

          {form.formState.errors.root?.message ? (
            <FormMessage className="text-destructive">{String(form.formState.errors.root.message)}</FormMessage>
          ) : null}
        </div>
      </Form>
    </main>
  )
}

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
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormField, fieldControlProps, useForm } from "@/components/ui/form"
import { Users } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  isMembershipOpen: z.boolean(),
  isPublicDirectory: z.boolean(),
  autoOrbitPlacement: z.boolean(),

  // Step 2
  avatarUrl: z.string().trim().url("Enter a valid URL").optional().or(z.literal("")),
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
      isMembershipOpen: true,
      isPublicDirectory: true,
      autoOrbitPlacement: false,
      avatarUrl: "",
      membershipConfig: "",
      orbitConfig: "",
    },
    mode: "onBlur",
  })

  const watchedHandle = form.watch("handle")
  const watchedName = form.watch("name")
  const watchedAvatarUrl = form.watch("avatarUrl")

  const [step, setStep] = React.useState<1 | 2>(1)
  const [created, setCreated] = React.useState<CreatedCommunity | null>(null)
  const [isNavigating, setIsNavigating] = React.useState(false)

  const STEPS: Record<1 | 2, { title: string; description: string }> = {
    1: { title: "Basics", description: "Name, handle, and a short description." },
    2: { title: "Avatar (optional)", description: "Add an avatar or skip — you can do this later in settings." },
  }

  const stepTitle = STEPS[step].title
  const stepDescription = STEPS[step].description

  const STEP_FIELDS: Record<1 | 2, Array<keyof FormValues>> = {
    1: ["name", "handle", "description", "isMembershipOpen", "isPublicDirectory", "autoOrbitPlacement"],
    2: ["avatarUrl", "membershipConfig", "orbitConfig"],
  }

  function buildCreatePayload(values: Pick<FormValues, "name" | "handle" | "description" | "isMembershipOpen" | "isPublicDirectory" | "autoOrbitPlacement">) {
    const handleCheck = validateHandle(values.handle)
    if (!handleCheck.ok) {
      return err(handleCheck.error)
    }

    return ok({
      name: values.name.trim(),
      handle: handleCheck.value,
      description: opt(values.description) ?? null,
      avatarUrl: null as string | null,
      isMembershipOpen: values.isMembershipOpen,
      isPublicDirectory: values.isPublicDirectory,
      autoOrbitPlacement: values.autoOrbitPlacement,
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
    if (isNavigating) return
    setIsNavigating(true)
    form.clearErrors("root")

    try {
      if (step === 1) {
        const okStep = await form.trigger(STEP_FIELDS[1] as any)
        if (!okStep) return

        const createdPayload = buildCreatePayload({
          name: form.getValues("name"),
          handle: form.getValues("handle"),
          description: form.getValues("description"),
          isMembershipOpen: form.getValues("isMembershipOpen"),
          isPublicDirectory: form.getValues("isPublicDirectory"),
          autoOrbitPlacement: form.getValues("autoOrbitPlacement"),
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

        // Persist avatar before navigating to the community page.
        await updateCommunity(form.getValues())

        if (created) router.push(communityPath(created.handle))
        return
      }
    } finally {
      setIsNavigating(false)
    }
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

  const canSubmit = step === 2 && !form.formState.isSubmitting

  /** Skip remaining steps and go to the community page. */
  function skipToFinish() {
    if (!created) return
    router.push(communityPath(created.handle))
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <Form form={form} onSubmit={onSubmit} className="mt-0">
        <PageHeader
          leading={
            <ProfileAvatar
              type="community"
              src={watchedAvatarUrl || undefined}
              name={watchedName || "New Community"}
              className="h-12 w-12"
            />
          }
          title="New Community"
          description={`Step ${step} of 2 · ${stepTitle}`}
        />

        {form.formState.errors.root?.message ? (
          <Alert variant="destructive">
            <AlertDescription>{String(form.formState.errors.root.message)}</AlertDescription>
          </Alert>
        ) : null}

        {step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
              <CardDescription>Name, handle, and a short description.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
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
              <div className="flex items-center justify-between gap-4 pt-4">
                <div className="flex items-center gap-3">
                  <FormField<FormValues, "isPublicDirectory">
                    name="isPublicDirectory"
                    render={({ field }) => (
                      <Select
                        value={field.value ? "Public" : "Private"}
                        onValueChange={(v) => field.onChange(v === "Public")}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="Public">Public</SelectItem>
                            <SelectItem value="Private">Private</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField<FormValues, "isMembershipOpen">
                    name="isMembershipOpen"
                    render={({ field }) => (
                      <Select
                        value={field.value ? "Open" : "Closed"}
                        onValueChange={(v) => field.onChange(v === "Open")}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="Open">Open</SelectItem>
                            <SelectItem value="Closed">Closed</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <Button type="button" onClick={goNext} disabled={isNavigating}>
                  {isNavigating ? "Saving…" : "Next"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card>
            <CardHeader>
              <CardTitle>Avatar</CardTitle>
              <CardDescription>A photo or image that represents the community across the platform.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex justify-center rounded-xl border border-dashed border-border p-6">
                <AvatarDropzone
                  value={watchedAvatarUrl || null}
                  alt={watchedName || "Community"}
                  fallbackIcon={Users}
                  className="flex flex-col items-center text-center"
                  upload={async (file) => {
                    if (!created?.id) {
                      throw new Error("Create the community first before uploading an avatar.")
                    }
                    const fd = new FormData()
                    fd.set("file", file)
                    fd.set("filename", file.name)
                    fd.set("contentType", file.type || "application/octet-stream")
                    fd.set("size", String(file.size))
                    fd.set("type", "community.avatar")
                    fd.set("communityId", created.id)

                    const resp = await fetch("/api/upload/sign", { method: "POST", body: fd })
                    const json = await resp.json().catch(() => null)

                    if (!resp.ok || !json?.ok) {
                      const parsed = parseApiError(json?.error ?? json)
                      throw new Error(parsed.formError || "Couldn’t upload avatar.")
                    }

                    const publicUrl = json.data?.publicUrl ?? json.data?.upload?.publicUrl ?? json.publicUrl
                    if (!publicUrl) throw new Error("Upload completed but public URL is missing.")

                    return { publicUrl }
                  }}
                  onChange={(url) => {
                    form.clearErrors("root")
                    form.setValue("avatarUrl", url ?? "", { shouldDirty: true, shouldTouch: true })
                  }}
                  onError={(message) => {
                    form.setError("root", { type: "server", message })
                  }}
                  onDelete={() => {
                    form.clearErrors("root")
                    form.setValue("avatarUrl", "", { shouldDirty: true, shouldTouch: true })
                  }}
                  hasImage={!!watchedAvatarUrl}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={skipToFinish}>
                  Skip
                </Button>
                <Button type="button" onClick={goNext} disabled={isNavigating}>
                  {isNavigating ? "Saving…" : "Finish"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

      </Form>
    </div>
  )
}

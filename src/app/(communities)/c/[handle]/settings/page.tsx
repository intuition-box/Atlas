"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useParams, useRouter } from "next/navigation"
import { getSession } from "next-auth/react"

import { apiGet, apiPost } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { Button } from "@/components/ui/button"
import { Form, FormActions, FormField, FormMessage, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"

const CommunitySettingsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  description: z.string().max(2000, "Description is too long"),
  avatarUrl: z.string().url("Enter a valid image URL").optional().or(z.literal("")),
  isPublicDirectory: z.boolean(),
  isMembershipOpen: z.boolean(),
})

type CommunitySettingsValues = z.infer<typeof CommunitySettingsSchema>

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
  }
}

type CommunityUpdateResponse = {
  community: {
    handle: string
  }
}

export default function CommunitySettingsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

  const form = useForm<CommunitySettingsValues>({
    resolver: zodResolver(CommunitySettingsSchema),
    defaultValues: {
      name: "",
      description: "",
      avatarUrl: "",
      isPublicDirectory: true,
      isMembershipOpen: true,
    },
    mode: "onBlur",
  })

  const [loading, setLoading] = React.useState(true)
  const [communityId, setCommunityId] = React.useState<string>("")
  const [deleteConfirm, setDeleteConfirm] = React.useState("")

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      // Enforce ownership client-side.
      const session = await getSession()
      const sessionHandle = session?.user?.handle

      if (!session?.user?.id || !sessionHandle) {
        if (!cancelled) router.replace(`/c/${handle}`)
        return
      }

      const res = await apiGet<CommunityGetResponse>("/api/community/get", { handle })
      if (!res.ok) {
        if (!cancelled) router.replace(`/c/${handle}`)
        return
      }

      if (cancelled) return

      const c = res.value.community

      const ownerId = c.ownerId ? String(c.ownerId) : ""
      const ownerHandle = c.owner?.handle ? String(c.owner.handle) : ""

      const isOwner = ownerId
        ? ownerId === session.user.id
        : ownerHandle
          ? ownerHandle === sessionHandle
          : false

      if (!isOwner) {
        router.replace(`/c/${handle}`)
        return
      }

      setCommunityId(String(c.id))

      form.reset(
        {
          name: c.name ?? "",
          description: c.description ?? "",
          avatarUrl: c.avatarUrl ?? "",
          isPublicDirectory: c.isPublicDirectory ?? true,
          isMembershipOpen: c.isMembershipOpen ?? true,
        },
        { keepDirty: false },
      )

      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [form, handle, router])

  function opt(value: string | undefined | null): string | undefined {
    const v = String(value ?? "").trim()
    return v ? v : undefined
  }

  async function onSubmit(values: CommunitySettingsValues) {
    form.clearErrors("root")

    if (!communityId) {
      form.setError("root", { type: "server", message: "Community is still loading. Try again." })
      return
    }

    const payload = {
      communityId,
      name: opt(values.name)!,
      description: opt(values.description) ?? null,
      avatarUrl: opt(values.avatarUrl) ?? null,
      isPublicDirectory: !!values.isPublicDirectory,
      isMembershipOpen: !!values.isMembershipOpen,
    }

    const result = await apiPost<CommunityUpdateResponse>("/api/community/update", payload)

    if (result.ok) {
      router.refresh()
      return
    }

    const err = result.error
    const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)

    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (key in form.getValues()) {
        form.setError(key as keyof CommunitySettingsValues, { type: "server", message })
      }
    }

    form.setError("root", {
      type: "server",
      message: parsed.formError || "We couldn’t update this community. Try again.",
    })
  }

  const rootError = form.formState.errors.root?.message

  if (!handle) return null

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Community settings</h1>
        <p className="text-sm text-muted-foreground">Manage your community profile and access rules.</p>
      </header>

      {rootError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <FormMessage className="text-destructive">{rootError}</FormMessage>
        </div>
      ) : null}

      <Form form={form} onSubmit={onSubmit} className="flex flex-col gap-10">
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
                fallback={String(form.watch("name") || "?").slice(0, 1).toUpperCase()}
                onChange={(url) => {
                  form.clearErrors("root")
                  form.setValue("avatarUrl", url ?? "", { shouldDirty: true, shouldTouch: true })
                }}
                sign={async (file) => {
                  const signed = await apiPost<{
                    upload: { uploadUrl: string; publicUrl: string; key: string }
                  }>("/api/upload/sign", {
                    type: "community.avatar",
                    contentType: file.type,
                    size: file.size,
                  })

                  if (!signed.ok) {
                    const err = signed.error
                    const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)
                    throw new Error(parsed.formError || "Couldn’t upload avatar.")
                  }

                  return {
                    uploadUrl: signed.value.upload.uploadUrl,
                    publicUrl: signed.value.upload.publicUrl,
                  }
                }}
                onError={(message) => {
                  form.setError("root", { type: "server", message })
                }}
              />

              {form.formState.errors.avatarUrl?.message ? (
                <FieldError>{String(form.formState.errors.avatarUrl.message)}</FieldError>
              ) : null}
            </Field>

            <div className="grid gap-4">
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Handle</div>
                <div className="mt-1 text-sm text-foreground/80">/c/{handle}</div>
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

        <section className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground/80">Privacy & access</h2>
          <p className="mt-1 text-xs text-muted-foreground">Control what non-members can see and whether applications are allowed.</p>

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
              description="If off, non-members won’t see the apply CTA (and we may 404 to avoid leaking closed spaces)."
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
                onChange={(e) => setDeleteConfirm(e.target.value)}
                aria-invalid={false}
              />

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Delete isn’t wired yet — this will be hooked to an API route with an extra confirmation step.
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteConfirm.trim() !== "DELETE"}
                  onClick={() => {
                    form.setError("root", {
                      type: "server",
                      message: "Delete isn’t wired yet. We’ll add the API route + confirmation flow next.",
                    })
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </section>

        <FormActions className="flex items-center gap-3">
          <Button type="submit" disabled={loading || !communityId || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.replace(`/c/${handle}`)}>
            Cancel
          </Button>
        </FormActions>
      </Form>
    </main>
  )
}
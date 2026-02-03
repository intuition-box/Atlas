"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useFieldArray } from "react-hook-form"
import { useParams, useRouter } from "next/navigation"
import { getSession } from "next-auth/react"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { userPath } from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { SKILLS } from "@/config/skills"
import { TOOLS } from "@/config/tools"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Form, FormActions, FormField, FormMessage, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"

// === SCHEMAS ===

const SettingsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  headline: z.string().max(120, "Headline is too long"),
  bio: z.string().max(2000, "Bio is too long"),
  location: z.string(),
  links: z.array(
    z.object({
      url: z
        .string()
        .trim()
        .max(2048, "Link is too long")
        .superRefine((value, ctx) => {
          if (!value) return
          try {
            new URL(value)
          } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid URL" })
          }
        }),
    })
  ),
  skills: z.array(z.string()),
  tools: z.array(z.string().max(80, "Tool is too long")),
  image: z.string().url("Enter a valid image URL").optional().or(z.literal("")),
})

type SettingsValues = z.infer<typeof SettingsSchema>

// === TYPES ===

type UserData = {
  handle: string | null
  name: string | null
  image: string | null
  headline: string | null
  bio: string | null
  location: string | null
  links: string[]
  skills: string[]
  tags: string[]
}

type UserGetResponse = {
  user: UserData
}

type UpdateUserResponse = {
  user: {
    handle: string | null
  }
}

type UploadSignResponse = {
  upload: { uploadUrl: string; publicUrl: string; key: string }
}

// === UTILITY FUNCTIONS ===

function optionalString(value: string | undefined | null): string | undefined {
  const v = String(value ?? "").trim()
  return v || undefined
}

function normalizeLinks(links: Array<{ url: string }>): string[] {
  return links.map((l) => l.url.trim()).filter(Boolean)
}

function normalizeStringArray(arr: string[]): string[] {
  return arr.map((s) => s.trim()).filter(Boolean)
}

function initializeLinks(links: unknown): Array<{ url: string }> {
  if (Array.isArray(links) && links.length > 0) {
    return links.map((url) => ({ url: String(url || "") }))
  }
  return [{ url: "" }]
}

function getCountryItems(): string[] {
  return COUNTRIES.map((c) => c.name)
}

function filterAvailableItems(allItems: readonly string[], selected: string[]): string[] {
  const selectedSet = new Set(selected.map((s) => s.toLowerCase()))
  return (allItems as string[]).filter((opt) => !selectedSet.has(opt.toLowerCase()))
}

// === CUSTOM HOOKS ===

function useSessionCheck(handle: string) {
  const router = useRouter()
  const [isOwner, setIsOwner] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    let cancelled = false

    getSession().then((session) => {
      if (cancelled) return

      const sessionHandle = session?.user?.handle
      const isAuthorized = !!(session?.user?.id && sessionHandle && sessionHandle === handle)

      setIsOwner(isAuthorized)

      if (!isAuthorized) {
        router.replace(userPath(handle))
      }
    })

    return () => {
      cancelled = true
    }
  }, [handle, router])

  return isOwner
}

function useUserData(handle: string, isOwner: boolean | null) {
  const router = useRouter()
  const [userData, setUserData] = React.useState<UserData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (isOwner === null || !isOwner) {
      return
    }

    let cancelled = false

    async function load() {
      try {
        const res = await apiGet<UserGetResponse>("/api/user/get", { handle })

        if (cancelled) return

        if (!res.ok) {
          router.replace(userPath(handle))
          return
        }

        setUserData(res.value.user)
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError("An unexpected error occurred while loading your profile.")
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [handle, isOwner, router])

  return { userData, loading, error }
}

function useToolsState() {
  const [toolOptions, setToolOptions] = React.useState<string[]>([...TOOLS])
  const [toolQuery, setToolQuery] = React.useState("")

  const addToolOption = React.useCallback((tool: string) => {
    setToolOptions((prev) => {
      if (prev.some((t) => t.toLowerCase() === tool.toLowerCase())) {
        return prev
      }
      return [tool, ...prev]
    })
  }, [])

  return {
    toolOptions,
    toolQuery,
    setToolQuery,
    addToolOption,
  }
}

// === SUB-COMPONENTS ===

function AvatarSection({
  form,
  onAvatarSign,
  onAvatarError,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
  onAvatarSign: (file: File) => Promise<{ uploadUrl: string; publicUrl: string }>
  onAvatarError: (message: string) => void
}) {
  const avatarValue = form.watch("image")

  return (
    <Field data-slot="settings-avatar" name="image" invalid={!!form.formState.errors.image}>
      <FieldLabel>Avatar</FieldLabel>
      <FieldDescription>Drop an image on the avatar to replace it.</FieldDescription>

      <AvatarDropzone
        value={String(avatarValue || "") || null}
        alt="Avatar"
        onChange={(url) => {
          form.clearErrors("root")
          form.setValue("image", url ?? "", { shouldDirty: true, shouldTouch: true })
        }}
        sign={onAvatarSign}
        onError={onAvatarError}
      />

      {form.formState.errors.image?.message && (
        <FieldError>{String(form.formState.errors.image.message)}</FieldError>
      )}
    </Field>
  )
}

function LinksSection({
  form,
  links,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
  links: ReturnType<typeof useFieldArray<SettingsValues, "links">>
}) {
  return (
    <Field data-slot="settings-links" name="links" invalid={!!form.formState.errors.links}>
      <FieldLabel>Links</FieldLabel>
      <FieldDescription>Add your website or social profiles (one per line).</FieldDescription>

      <div className="flex flex-col gap-2">
        {links.fields.map((item, index) => {
          const err = form.formState.errors.links?.[index]?.url?.message
          return (
            <div key={item.id} className="flex items-start gap-2">
              <Input
                placeholder="https://..."
                {...form.register(`links.${index}.url` as const)}
                aria-invalid={!!err}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => links.remove(index)}
                disabled={links.fields.length <= 1}
              >
                Remove
              </Button>
            </div>
          )
        })}

        <Button
          type="button"
          variant="secondary"
          onClick={() => links.append({ url: "" })}
          className="self-start"
        >
          + Add another link
        </Button>
      </div>

      {typeof form.formState.errors.links?.message === "string" && (
        <FieldError>{form.formState.errors.links.message}</FieldError>
      )}
    </Field>
  )
}

function SkillsSection({
  form,
  skillQuery,
  onSkillQueryChange,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
  skillQuery: string
  onSkillQueryChange: (value: string) => void
}) {
  return (
    <Field data-slot="settings-skills" name="skills" invalid={!!form.formState.errors.skills}>
      <FieldLabel>Skills</FieldLabel>
      <FieldDescription>Pick from the list (type to filter). You can add multiple.</FieldDescription>

      <FormField<SettingsValues, "skills">
        name="skills"
        render={({ id, field }) => {
          const selected: string[] = Array.isArray(field.value) ? field.value : []
          const items = filterAvailableItems(SKILLS, selected)

          return (
            <Combobox
              items={items}
              value={null}
              inputValue={skillQuery}
              onInputValueChange={(v) => onSkillQueryChange(String(v ?? ""))}
              onValueChange={(value) => {
                if (typeof value !== "string" || !value) return
                field.onChange([...selected, value])
                onSkillQueryChange("")
              }}
            >
              <ComboboxInput id={id} placeholder="Add a skill…" className="w-full" showClear showTrigger />

              <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
                <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">
                  No skills found.
                </ComboboxEmpty>
                <ComboboxList className="max-h-64 overflow-auto">
                  <ComboboxCollection>
                    {(item: string) => (
                      <ComboboxItem
                        key={item}
                        value={item}
                        className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
                      >
                        <span className="flex-1">{item}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxList>
              </ComboboxContent>

              {selected.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="bg-muted-foreground/10 text-foreground inline-flex h-[calc(--spacing(5.5))] items-center justify-center rounded-4xl px-2 text-xs font-medium"
                      onClick={() => field.onChange(selected.filter((x) => x !== s))}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </Combobox>
          )
        }}
      />
    </Field>
  )
}

function ToolsSection({
  form,
  toolOptions,
  toolQuery,
  onToolQueryChange,
  onAddTool,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
  toolOptions: string[]
  toolQuery: string
  onToolQueryChange: (value: string) => void
  onAddTool: (tool: string) => void
}) {
  return (
    <Field data-slot="settings-tools" name="tools" invalid={!!form.formState.errors.tools}>
      <FieldLabel>Tools</FieldLabel>
      <FieldDescription>Pick from suggestions (type to filter) or press Enter to add a new tool.</FieldDescription>

      <FormField<SettingsValues, "tools">
        name="tools"
        render={({ id, field }) => {
          const selected: string[] = Array.isArray(field.value) ? field.value : []
          const items = filterAvailableItems(toolOptions, selected)

          function handleAddTool(tool: string) {
            const v = tool.trim()
            if (!v) return

            const lowerSelected = new Set(selected.map((s) => s.toLowerCase()))
            if (lowerSelected.has(v.toLowerCase())) return

            onAddTool(v)
            field.onChange([...selected, v])
            onToolQueryChange("")
          }

          return (
            <Combobox
              items={items}
              value={null}
              inputValue={toolQuery}
              onInputValueChange={(v) => onToolQueryChange(String(v ?? ""))}
              onValueChange={(value) => {
                if (typeof value !== "string" || !value) return
                handleAddTool(value)
              }}
            >
              <ComboboxInput
                id={id}
                placeholder="Add a tool…"
                className="w-full"
                showClear
                showTrigger
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return
                  e.preventDefault()
                  handleAddTool(toolQuery)
                }}
              />

              <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
                <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">
                  Press Enter to add "{toolQuery.trim() || "…"}".
                </ComboboxEmpty>
                <ComboboxList className="max-h-64 overflow-auto">
                  <ComboboxCollection>
                    {(item: string) => (
                      <ComboboxItem
                        key={item}
                        value={item}
                        className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
                      >
                        <span className="flex-1">{item}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxList>
              </ComboboxContent>

              {selected.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="bg-muted-foreground/10 text-foreground inline-flex h-[calc(--spacing(5.5))] items-center justify-center rounded-4xl px-2 text-xs font-medium"
                      onClick={() => field.onChange(selected.filter((x) => x !== t))}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </Combobox>
          )
        }}
      />
    </Field>
  )
}

// === MAIN COMPONENT ===

export default function UserSettingsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

  const isOwner = useSessionCheck(handle)
  const { userData, loading, error } = useUserData(handle, isOwner)

  const form = useForm<SettingsValues>({
    resolver: zodResolver(SettingsSchema),
    defaultValues: {
      name: "",
      headline: "",
      bio: "",
      location: "",
      links: [{ url: "" }],
      skills: [],
      tools: [],
      image: "",
    },
    mode: "onBlur",
  })

  const links = useFieldArray({ control: form.control, name: "links" })
  const [skillQuery, setSkillQuery] = React.useState("")
  const { toolOptions, toolQuery, setToolQuery, addToolOption } = useToolsState()

  // Initialize form when userData loads
  React.useEffect(() => {
    if (!userData) return

    form.reset(
      {
        name: userData.name ?? "",
        headline: userData.headline ?? "",
        bio: userData.bio ?? "",
        location: userData.location ?? "",
        links: initializeLinks(userData.links),
        skills: Array.isArray(userData.skills) ? userData.skills : [],
        tools: Array.isArray(userData.tags) ? userData.tags : [],
        image: userData.image ?? "",
      },
      { keepDirty: false }
    )
  }, [userData, form])

  // Set error from hook
  React.useEffect(() => {
    if (error) {
      form.setError("root", { type: "server", message: error })
    }
  }, [error, form])

  async function handleAvatarSign(file: File) {
    const signed = await apiPost<UploadSignResponse>("/api/upload/sign", {
      type: "user.avatar",
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

  async function handleSubmit(values: SettingsValues) {
    form.clearErrors("root")

    const payload = {
      name: optionalString(values.name)!,
      headline: optionalString(values.headline),
      bio: optionalString(values.bio),
      location: optionalString(values.location),
      links: normalizeLinks(values.links),
      skills: normalizeStringArray(values.skills),
      tags: normalizeStringArray(values.tools),
      image: optionalString(values.image) ?? null,
    }

    const result = await apiPost<UpdateUserResponse>("/api/user/update", payload)

    if (result.ok) {
      router.refresh()
      return
    }

    const err = result.error
    const parsed = parseApiError(err)

    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (key in form.getValues()) {
        form.setError(key as keyof SettingsValues, { type: "server", message })
      }
    }

    form.setError("root", {
      type: "server",
      message: parsed.formError || "We couldn't update your profile. Try again.",
    })
  }

  function handleCancel() {
    router.replace(userPath(handle))
  }

  const rootError = form.formState.errors.root?.message
  const countryItems = React.useMemo(() => getCountryItems(), [])

  if (!handle) return null
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Form form={form} onSubmit={handleSubmit} className="flex flex-col gap-10">
        <PageHeader
          leading={
            <Avatar className="h-12 w-12">
              <AvatarImage src={String(form.watch("image") || "") || undefined} alt={`@${handle}`} />
              <AvatarFallback>{String(handle || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          }
          title="Account settings"
          description={`/u/${handle}`}
          actions={
            <FormActions className="flex items-center gap-3">
              <Button type="submit" disabled={loading || form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
            </FormActions>
          }
        />

        {rootError ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <FormMessage className="text-destructive">{rootError}</FormMessage>
          </div>
        ) : null}

        <AvatarSection form={form} onAvatarSign={handleAvatarSign} onAvatarError={handleAvatarError} />

        <FormField<SettingsValues, "name">
          name="name"
          label="Name"
          required
          render={({ id, field, fieldState }) => (
            <Input {...fieldControlProps(field, { id, invalid: fieldState.invalid })} value={field.value ?? ""} />
          )}
        />

        <FormField<SettingsValues, "headline">
          name="headline"
          label="Headline"
          description="Short description shown under your name"
          render={({ id, field, fieldState }) => (
            <Input {...fieldControlProps(field, { id, invalid: fieldState.invalid })} value={field.value ?? ""} />
          )}
        />

        <FormField<SettingsValues, "location">
          name="location"
          label="Location"
          description="Where you're based"
          render={({ id, field, fieldState }) => (
            <Combobox
              items={countryItems}
              value={field.value ? field.value : null}
              onValueChange={(value) => field.onChange(typeof value === "string" ? value : "")}
            >
              <ComboboxInput
                id={id}
                placeholder="Select a country"
                aria-invalid={fieldState.invalid}
                className="w-full"
                showClear
                showTrigger
              />

              <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
                <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">No countries found.</ComboboxEmpty>
                <ComboboxList className="max-h-64 overflow-auto">
                  <ComboboxCollection>
                    {(item: string) => (
                      <ComboboxItem
                        key={item}
                        value={item}
                        className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
                      >
                        <span className="flex-1">{item}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}
        />

        <FormField<SettingsValues, "bio">
          name="bio"
          label="Bio"
          render={({ id, field, fieldState }) => (
            <Textarea
              {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
              value={String(field.value ?? "")}
              rows={5}
            />
          )}
        />

        <LinksSection form={form} links={links} />

        <SkillsSection form={form} skillQuery={skillQuery} onSkillQueryChange={setSkillQuery} />

        <ToolsSection
          form={form}
          toolOptions={toolOptions}
          toolQuery={toolQuery}
          onToolQueryChange={setToolQuery}
          onAddTool={addToolOption}
        />
      </Form>
    </main>
  )
}
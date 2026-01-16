"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useFieldArray } from "react-hook-form"
import { useParams, useRouter } from "next/navigation"
import { getSession } from "next-auth/react"

import { apiGet, apiPost } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"
import { userPath } from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { SKILLS } from "@/config/skills"
import { TOOLS } from "@/config/tools"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { Button } from "@/components/ui/button"
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
            // eslint-disable-next-line no-new
            new URL(value)
          } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid URL" })
          }
        }),
    }),
  ),
  skills: z.array(z.string()),
  tools: z.array(z.string().max(80, "Tool is too long")),
  image: z.string().url("Enter a valid image URL").optional().or(z.literal("")),
})

type SettingsValues = z.infer<typeof SettingsSchema>

type UserGetResponse = {
  user: {
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
}

type UpdateUserResponse = {
  user: {
    handle: string | null
  }
}

export default function UserSettingsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

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

  const [loading, setLoading] = React.useState(true)
  const [skillQuery, setSkillQuery] = React.useState("")
  const [toolQuery, setToolQuery] = React.useState("")
  const [toolOptions, setToolOptions] = React.useState<string[]>(() => [...TOOLS])

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      // Enforce ownership on the client.
      const session = await getSession()
      const sessionHandle = session?.user?.handle

      if (!session?.user?.id || !sessionHandle || sessionHandle !== handle) {
        if (!cancelled) router.replace(userPath(handle))
        return
      }

      const res = await apiGet<UserGetResponse>("/api/user/get", { handle })
      if (!res.ok) {
        // Public profiles should load, but if anything goes wrong just send them back.
        if (!cancelled) router.replace(userPath(handle))
        return
      }

      if (cancelled) return

      const u = res.value.user

      form.reset(
        {
          name: u.name ?? "",
          headline: u.headline ?? "",
          bio: u.bio ?? "",
          location: u.location ?? "",
          links: (Array.isArray(u.links) && u.links.length ? u.links : [""]).map((url) => ({ url })),
          skills: Array.isArray(u.skills) ? u.skills : [],
          tools: Array.isArray(u.tags) ? u.tags : [],
          image: u.image ?? "",
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

  async function onSubmit(values: SettingsValues) {
    form.clearErrors("root")

    const payload = {
      name: opt(values.name)!,
      headline: opt(values.headline),
      bio: opt(values.bio),
      location: opt(values.location),
      links: values.links
        .map((l) => l.url.trim())
        .filter(Boolean),
      skills: values.skills.map((s) => s.trim()).filter(Boolean),
      tags: values.tools.map((t) => t.trim()).filter(Boolean),
      image: opt(values.image) ?? null,
    }

    const result = await apiPost<UpdateUserResponse>("/api/user/update", payload)

    if (result.ok) {
      router.refresh()
      return
    }

    const err = result.error
    const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)

    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (key in form.getValues()) {
        form.setError(key as keyof SettingsValues, { type: "server", message })
      }
    }

    form.setError("root", {
      type: "server",
      message: parsed.formError || "We couldn’t update your profile. Try again.",
    })
  }

  const rootError = form.formState.errors.root?.message

  if (!handle) return null

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Account settings</h1>
        <p className="text-sm text-muted-foreground">Update your profile details.</p>
      </header>

      {rootError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <FormMessage className="text-destructive">{rootError}</FormMessage>
        </div>
      ) : null}

      <Form form={form} onSubmit={onSubmit} className="flex flex-col gap-10">
        <Field data-slot="settings-avatar" name="image" invalid={!!form.formState.errors.image}>
          <FieldLabel>Avatar</FieldLabel>
          <FieldDescription>Drop an image on the avatar to replace it.</FieldDescription>

          <AvatarDropzone
            value={String(form.watch("image") || "") || null}
            alt="Avatar"
            fallback={String(form.watch("name") || "?").slice(0, 1).toUpperCase()}
            onChange={(url) => {
              form.clearErrors("root")
              form.setValue("image", url ?? "", { shouldDirty: true, shouldTouch: true })
            }}
            sign={async (file) => {
              const signed = await apiPost<{
                upload: { uploadUrl: string; publicUrl: string; key: string }
              }>("/api/upload/sign", {
                type: "user.avatar",
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

          {form.formState.errors.image?.message ? (
            <FieldError>{String(form.formState.errors.image.message)}</FieldError>
          ) : null}
        </Field>

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
          description="Where you’re based"
          render={({ id, field, fieldState }) => {
            const countryItems = COUNTRIES.map((c) => c.name)

            return (
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
            )
          }}
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

            <Button type="button" variant="secondary" onClick={() => links.append({ url: "" })} className="self-start">
              + Add another link
            </Button>
          </div>

          {typeof form.formState.errors.links?.message === "string" ? (
            <FieldError>{form.formState.errors.links.message}</FieldError>
          ) : null}
        </Field>

        <Field data-slot="settings-skills" name="skills" invalid={!!form.formState.errors.skills}>
          <FieldLabel>Skills</FieldLabel>
          <FieldDescription>Pick from the list (type to filter). You can add multiple.</FieldDescription>

          <FormField<SettingsValues, "skills">
            name="skills"
            render={({ id, field }) => {
              const selected: string[] = Array.isArray(field.value) ? field.value : []
              const items = SKILLS.filter((opt) => !selected.includes(opt))

              return (
                <Combobox
                  items={items as unknown as string[]}
                  value={null}
                  inputValue={skillQuery}
                  onInputValueChange={(v) => setSkillQuery(String(v ?? ""))}
                  onValueChange={(value) => {
                    if (typeof value !== "string" || !value) return
                    field.onChange([...selected, value])
                    setSkillQuery("")
                  }}
                >
                  <ComboboxInput id={id} placeholder="Add a skill…" className="w-full" showClear showTrigger />

                  <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
                    <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">No skills found.</ComboboxEmpty>
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

                  {selected.length ? (
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
                  ) : null}
                </Combobox>
              )
            }}
          />
        </Field>

        <Field data-slot="settings-tools" name="tools" invalid={!!form.formState.errors.tools}>
          <FieldLabel>Tools</FieldLabel>
          <FieldDescription>Pick from suggestions (type to filter) or press Enter to add a new tool.</FieldDescription>

          <FormField<SettingsValues, "tools">
            name="tools"
            render={({ id, field }) => {
              const selected: string[] = Array.isArray(field.value) ? field.value : []
              const lowerSelected = new Set(selected.map((s) => s.toLowerCase()))

              const items = toolOptions.filter((opt) => !lowerSelected.has(opt.toLowerCase()))

              function addTool(next: string) {
                const v = next.trim()
                if (!v) return
                if (lowerSelected.has(v.toLowerCase())) return

                if (!toolOptions.some((t) => t.toLowerCase() === v.toLowerCase())) {
                  setToolOptions((prev) => [v, ...prev])
                }

                field.onChange([...selected, v])
                setToolQuery("")
              }

              return (
                <Combobox
                  items={items}
                  value={null}
                  inputValue={toolQuery}
                  onInputValueChange={(v) => setToolQuery(String(v ?? ""))}
                  onValueChange={(value) => {
                    if (typeof value !== "string" || !value) return
                    addTool(value)
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
                      addTool(toolQuery)
                    }}
                  />

                  <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
                    <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">
                      Press Enter to add “{toolQuery.trim() || "…"}”.
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

                  {selected.length ? (
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
                  ) : null}
                </Combobox>
              )
            }}
          />
        </Field>

        <FormActions className="flex items-center gap-3">
          <Button type="submit" disabled={loading || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.replace(userPath(handle))}>
            Cancel
          </Button>
        </FormActions>
      </Form>
    </main>
  )
}
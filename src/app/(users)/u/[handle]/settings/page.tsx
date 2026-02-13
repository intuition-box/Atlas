"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useFieldArray } from "react-hook-form"
import { useParams, useRouter } from "next/navigation"
import { getSession } from "next-auth/react"
import { X } from "lucide-react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { userPath, userSettingsPath } from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { SKILL_LIST as SKILLS, TOOL_LIST as TOOLS } from "@/lib/attestations/definitions"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { HandleField } from "@/components/common/handle-field"
import { PageHeader } from "@/components/common/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Form, FormActions, FormField, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

// === SCHEMAS ===

const SettingsSchema = z.object({
  handle: z.string().trim().min(1, "Handle is required"),
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
      } catch {
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

function useSkillsState() {
  const [skillOptions, setSkillOptions] = React.useState<string[]>([...SKILLS])
  const [skillQuery, setSkillQuery] = React.useState("")

  const addSkillOption = React.useCallback((skill: string) => {
    setSkillOptions((prev) => {
      if (prev.some((s) => s.toLowerCase() === skill.toLowerCase())) {
        return prev
      }
      return [skill, ...prev]
    })
  }, [])

  return {
    skillOptions,
    skillQuery,
    setSkillQuery,
    addSkillOption,
  }
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

// === LOADING SKELETON ===

function SettingsSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
      {/* Header skeleton */}
      <Card>
        <CardContent className="flex items-center gap-4 px-5">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
        </CardContent>
      </Card>

      {/* Section skeletons */}
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-4 px-5">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// === SUB-COMPONENTS ===

function ProfileSection({
  form,
  onAvatarError,
  currentHandle,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
  onAvatarError: (message: string) => void
  currentHandle: string
}) {
  const avatarValue = form.watch("image")
  const watchedName = form.watch("name")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your public identity across communities.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 px-5">
        <Field data-slot="settings-avatar" name="image" invalid={!!form.formState.errors.image}>
          <FieldLabel>Avatar</FieldLabel>

          <div className="flex justify-center rounded-xl border border-dashed border-border p-6">
            <AvatarDropzone
              value={String(avatarValue || "") || null}
              alt="Avatar"
              className="flex flex-col items-center text-center"
              uploadType="user.avatar"
              onChange={(url) => {
                form.clearErrors("root")
                form.setValue("image", url ?? "", { shouldDirty: true, shouldTouch: true })
              }}
              onError={onAvatarError}
            />
          </div>

          {form.formState.errors.image?.message && (
            <FieldError>{String(form.formState.errors.image.message)}</FieldError>
          )}
        </Field>

        <FormField<SettingsValues, "handle">
          name="handle"
          label="Handle"
          required
          description="The old URL will return 404 immediately after a rename. The old handle may be reclaimable for a limited time."
          render={({ id, field, fieldState }) => (
            <HandleField
              id={id}
              field={field}
              fieldState={fieldState}
              nameValue={watchedName}
              currentHandle={currentHandle}
              ownerType="USER"
            />
          )}
        />

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
      </CardContent>
    </Card>
  )
}

function AboutSection({
  form,
  countryItems,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
  countryItems: string[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>Tell people a bit about yourself.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 px-5">
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
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Links</CardTitle>
        <CardDescription>Add your website or social profiles.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 px-5">
        <Field data-slot="settings-links" name="links" invalid={!!form.formState.errors.links}>
          <div className="flex flex-col gap-2">
            {links.fields.map((item, index) => (
                <div key={item.id} className="relative">
                  <Controller
                    name={`links.${index}.url`}
                    control={form.control}
                    render={({ field: { ref: _ref, ...field }, fieldState }) => (
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        placeholder="https://..."
                        aria-invalid={fieldState.invalid || undefined}
                        className="w-full pr-9"
                      />
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      if (links.fields.length <= 1) {
                        links.replace([{ url: "" }])
                      } else {
                        links.remove(index)
                      }
                    }}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-destructive"
                    aria-label="Remove link"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="pointer-events-none" />
                  </Button>
                </div>
            ))}

            <Button
              type="button"
              variant="secondary"
              onClick={() => links.append({ url: "" }, { shouldFocus: false })}
              className="self-start"
            >
              + Add another link
            </Button>
          </div>

          {typeof form.formState.errors.links?.message === "string" && (
            <FieldError>{form.formState.errors.links.message}</FieldError>
          )}
        </Field>
      </CardContent>
    </Card>
  )
}

function SkillsAndToolsSection({
  form,
  skillOptions,
  skillQuery,
  onSkillQueryChange,
  onAddSkill,
  toolOptions,
  toolQuery,
  onToolQueryChange,
  onAddTool,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
  skillOptions: string[]
  skillQuery: string
  onSkillQueryChange: (value: string) => void
  onAddSkill: (skill: string) => void
  toolOptions: string[]
  toolQuery: string
  onToolQueryChange: (value: string) => void
  onAddTool: (tool: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Skills & tools</CardTitle>
        <CardDescription>What you&apos;re good at and what you work with.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 px-5">
        {/* Skills */}
        <Field data-slot="settings-skills" name="skills" invalid={!!form.formState.errors.skills}>
          <FieldLabel>Skills</FieldLabel>
          <FieldDescription>Pick from suggestions or press Enter to add a custom skill.</FieldDescription>

          <FormField<SettingsValues, "skills">
            name="skills"
            render={({ id, field }) => {
              const selected: string[] = Array.isArray(field.value) ? field.value : []
              const items = filterAvailableItems(skillOptions, selected)

              function handleAddSkill(skill: string) {
                const v = skill.trim()
                if (!v) return

                const lowerSelected = new Set(selected.map((s) => s.toLowerCase()))
                if (lowerSelected.has(v.toLowerCase())) return

                onAddSkill(v)
                field.onChange([...selected, v])
                onSkillQueryChange("")
              }

              return (
                <Combobox
                  items={items}
                  value={null}
                  inputValue={skillQuery}
                  onInputValueChange={(v) => onSkillQueryChange(String(v ?? ""))}
                  onValueChange={(value) => {
                    if (typeof value !== "string" || !value) return
                    handleAddSkill(value)
                  }}
                >
                  <ComboboxInput
                    id={id}
                    placeholder="Add a skill…"
                    className="w-full"
                    showClear
                    showTrigger
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return
                      e.preventDefault()
                      handleAddSkill(skillQuery)
                    }}
                  />

                  <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
                    <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">
                      {skillQuery.trim()
                        ? <>Press Enter to add &ldquo;{skillQuery.trim()}&rdquo;.</>
                        : "All suggestions selected. Type to add a custom skill."}
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
                        <Badge
                          key={s}
                          variant="secondary"
                          className="cursor-pointer gap-1"
                          render={<button type="button" onClick={() => field.onChange(selected.filter((x) => x !== s))} />}
                        >
                          {s}
                          <X data-icon="inline-end" className="size-3" />
                        </Badge>
                      ))}
                    </div>
                  )}
                </Combobox>
              )
            }}
          />
        </Field>

        {/* Tools */}
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
                      {toolQuery.trim()
                        ? <>Press Enter to add &ldquo;{toolQuery.trim()}&rdquo;.</>
                        : "All suggestions selected. Type to add a custom tool."}
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
                        <Badge
                          key={t}
                          variant="secondary"
                          className="cursor-pointer gap-1"
                          render={<button type="button" onClick={() => field.onChange(selected.filter((x) => x !== t))} />}
                        >
                          {t}
                          <X data-icon="inline-end" className="size-3" />
                        </Badge>
                      ))}
                    </div>
                  )}
                </Combobox>
              )
            }}
          />
        </Field>
      </CardContent>
    </Card>
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
      handle: "",
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
  const { skillOptions, skillQuery, setSkillQuery, addSkillOption } = useSkillsState()
  const { toolOptions, toolQuery, setToolQuery, addToolOption } = useToolsState()

  // Initialize form when userData loads
  React.useEffect(() => {
    if (!userData) return

    form.reset(
      {
        handle: userData.handle ?? "",
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

  // Avatar uses default proxy upload with type "user.avatar"
  // No custom sign/upload needed — defaultUploadViaApi handles it

  function handleAvatarError(message: string) {
    form.setError("root", { type: "server", message })
  }

  async function handleSubmit(values: SettingsValues) {
    form.clearErrors("root")

    const payload = {
      handle: values.handle.trim(),
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
      const newHandle = result.value.user.handle
      if (newHandle && newHandle !== handle) {
        router.replace(userSettingsPath(newHandle))
      }
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

    if (!parsed.formError && parsed.fieldErrors.handle) {
      // Don't show a generic root error when the handle field already shows the issue.
    } else {
      form.setError("root", {
        type: "server",
        message: parsed.formError || "We couldn't update your profile. Try again.",
      })
    }
  }

  function handleCancel() {
    router.replace(userPath(handle))
  }

  const rootError = form.formState.errors.root?.message
  const countryItems = React.useMemo(() => getCountryItems(), [])

  if (!handle) return null

  // Show skeleton while loading
  if (isOwner === null || loading) {
    return <SettingsSkeleton />
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
      <Form form={form} onSubmit={handleSubmit} className="flex flex-col gap-6">
        <PageHeader
          leading={
            <Avatar className="h-12 w-12">
              <AvatarImage src={form.watch("image") || userData?.image || undefined} alt={`@${handle}`} />
              <AvatarFallback>{String(handle || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          }
          title="Account settings"
          description={`@${handle}`}
          actions={
            <FormActions className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save"}
              </Button>
            </FormActions>
          }
        />

        {rootError ? (
          <Alert variant="destructive">
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}

        <ProfileSection
          form={form}
          onAvatarError={handleAvatarError}
          currentHandle={handle}
        />

        <AboutSection form={form} countryItems={countryItems} />

        <LinksSection form={form} links={links} />

        <SkillsAndToolsSection
          form={form}
          skillOptions={skillOptions}
          skillQuery={skillQuery}
          onSkillQueryChange={setSkillQuery}
          onAddSkill={addSkillOption}
          toolOptions={toolOptions}
          toolQuery={toolQuery}
          onToolQueryChange={setToolQuery}
          onAddTool={addToolOption}
        />
      </Form>
    </div>
  )
}

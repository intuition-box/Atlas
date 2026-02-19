"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useFieldArray } from "react-hook-form"
import { useParams, useRouter } from "next/navigation"
import { getSession, signIn, useSession } from "next-auth/react"
import { Loader2, X } from "lucide-react"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { userPath, userSettingsPath } from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { LANGUAGE_LIST as LANGUAGES } from "@/config/languages"
import { SKILL_LIST as SKILLS, TOOL_LIST as TOOLS } from "@/lib/attestations/definitions"

import { AvatarDropzone } from "@/components/common/avatar-dropzone"
import { HandleField } from "@/components/common/handle-field"
import { PageHeader } from "@/components/common/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { EncryptedText } from "@/components/ui/encrypted-text"
import { DiscordIcon, GitHubIcon, XIcon } from "@/components/ui/icons"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { WalletLinkSection } from "@/components/users/wallet-link-section"

// === SCHEMAS ===

const SettingsSchema = z.object({
  handle: z.string().trim().min(1, "Handle is required"),
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  headline: z.string().max(120, "Headline is too long"),
  bio: z.string().max(2000, "Bio is too long"),
  location: z.string(),
  links: z.array(
    z.object({ url: z.string().trim().max(2048, "Link is too long") })
  ).max(5, "Maximum 5 links"),
  languages: z.array(z.string()),
  skills: z.array(z.string()),
  tools: z.array(z.string().max(80, "Tool is too long")),
  image: z.string().optional(),
  contactPreference: z.enum(["discord", "email", "telegram", "x", ""]).optional(),
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
  languages: string[]
  skills: string[]
  tags: string[]
  contactPreference: string | null
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
  return links
    .map((l) => l.url.trim())
    .filter(Boolean)
    .map((url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`))
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

function useLanguagesState() {
  const [languageOptions, setLanguageOptions] = React.useState<string[]>([...LANGUAGES])
  const [languageQuery, setLanguageQuery] = React.useState("")

  const addLanguageOption = React.useCallback((language: string) => {
    setLanguageOptions((prev) => {
      if (prev.some((l) => l.toLowerCase() === language.toLowerCase())) {
        return prev
      }
      return [language, ...prev]
    })
  }, [])

  return {
    languageOptions,
    languageQuery,
    setLanguageQuery,
    addLanguageOption,
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
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-7 pb-40">
      <div className="w-full flex flex-wrap gap-3 p-5">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex gap-3 ml-auto sm:align-center sm:justify-end">
          <Skeleton className="h-9 w-14" />
          <Skeleton className="h-9 w-14" />
        </div>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle>
            <Skeleton className="h-5 w-24" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-86" />
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle>
            <Skeleton className="h-5 w-24" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-86" />
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full" />
        </CardContent>
      </Card>

      {[1, 2, 3, 4, 5].map((i) => (
        <Card key={i}>
          <CardHeader className="gap-4">
            <CardTitle>
              <Skeleton className="h-5 w-24" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="h-4 w-86" />
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-48" />
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

      <CardContent className="flex flex-col gap-6">
        <Field data-slot="settings-avatar" name="image" invalid={!!form.formState.errors.image}>
          <FieldLabel>Avatar</FieldLabel>
          <FieldDescription>A photo that represents you across the platform.</FieldDescription>

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
          description="The name people know you by."
          render={({ id, field, fieldState }) => (
            <Input {...fieldControlProps(field, { id, invalid: fieldState.invalid })} value={field.value ?? ""} />
          )}
        />

        <FormField<SettingsValues, "headline">
          name="headline"
          label="Headline"
          description="Short description shown under your name."
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
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>Tell people a bit about yourself.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <FormField<SettingsValues, "bio">
          name="bio"
          label="Bio"
          description="Share your background, experience, and what drives you."
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

function CountryLanguageSection({
  form,
  countryItems,
  languageOptions,
  languageQuery,
  onLanguageQueryChange,
  onAddLanguage,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
  countryItems: string[]
  languageOptions: string[]
  languageQuery: string
  onLanguageQueryChange: (value: string) => void
  onAddLanguage: (language: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Location & languages</CardTitle>
        <CardDescription>Where you&apos;re based and what languages you speak.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <FormField<SettingsValues, "location">
          name="location"
          label="Country"
          description="Where you're based."
          render={({ id, field, fieldState }) => (
            <div className="relative">
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
                  showTrigger={!field.value}
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
              {field.value ? (
                <Button
                  className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer bg-destructive/10 text-destructive hover:bg-destructive/20 h-5 px-2 py-0.5 text-xs font-medium"
                  onClick={() => field.onChange("")}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          )}
        />

        <Field data-slot="settings-languages" name="languages" invalid={!!form.formState.errors.languages}>
          <FieldLabel>Languages</FieldLabel>
          <FieldDescription>Pick from suggestions or press Enter to add a custom language.</FieldDescription>

          <FormField<SettingsValues, "languages">
            name="languages"
            render={({ id, field }) => {
              const selected: string[] = Array.isArray(field.value) ? field.value : []
              const items = filterAvailableItems(languageOptions, selected)

              function handleAddLanguage(language: string) {
                const v = language.trim()
                if (!v) return

                const lowerSelected = new Set(selected.map((s) => s.toLowerCase()))
                if (lowerSelected.has(v.toLowerCase())) return

                onAddLanguage(v)
                field.onChange([...selected, v])
                onLanguageQueryChange("")
              }

              return (
                <Combobox
                  items={items}
                  value={null}
                  inputValue={languageQuery}
                  onInputValueChange={(v) => onLanguageQueryChange(String(v ?? ""))}
                  onValueChange={(value) => {
                    if (typeof value !== "string" || !value) return
                    handleAddLanguage(value)
                  }}
                >
                  <ComboboxInput
                    id={id}
                    placeholder="Add a language…"
                    className="w-full"
                    showClear
                    showTrigger
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return
                      e.preventDefault()
                      handleAddLanguage(languageQuery)
                    }}
                  />

                  <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
                    <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">
                      {languageQuery.trim()
                        ? <>Press Enter to add &ldquo;{languageQuery.trim()}&rdquo;.</>
                        : "All suggestions selected. Type to add a custom language."}
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
                      {selected.map((l) => (
                        <Badge
                          key={l}
                          variant="secondary"
                          className="cursor-pointer gap-1"
                          render={<button type="button" onClick={() => field.onChange(selected.filter((x) => x !== l))} />}
                        >
                          {l}
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
        <CardTitle>Portfolio</CardTitle>
        <CardDescription>Share links to your website or public portfolio.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
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
                        className="w-full pr-18"
                      />
                    )}
                  />
                  {(index > 0 || form.watch(`links.${index}.url`)) ? (
                    <Button
                      className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer bg-destructive/10 text-destructive hover:bg-destructive/20 h-5 px-2 py-0.5 text-xs font-medium"
                      onClick={() => {
                        if (links.fields.length <= 1) {
                          links.replace([{ url: "" }])
                        } else {
                          links.remove(index)
                        }
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
            ))}

            {links.fields.length < 5 && (
              <Button
                type="button"
                onClick={() => links.append({ url: "" }, { shouldFocus: false })}
                className="self-start"
              >
                + Add another link
              </Button>
            )}
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

      <CardContent className="flex flex-col gap-6">
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

// === CONNECTED ACCOUNTS SECTION ===

function TwitterAccountRow() {
  const { data: session, update: updateSession } = useSession()
  const [disconnecting, setDisconnecting] = React.useState(false)

  const twitterHandle = session?.user?.twitterHandle
  const isLinked = !!twitterHandle

  async function handleConnect() {
    await signIn("twitter", { callbackUrl: window.location.href })
  }

  async function handleDisconnect() {
    setDisconnecting(true)

    const result = await apiPost<{ disconnected: boolean }>(
      "/api/auth/accounts/disconnect",
      { provider: "twitter" },
    )

    if (result.ok) {
      await updateSession()
    }

    setDisconnecting(false)
  }

  return (
    <div className={isLinked ? "rounded-lg border border-border/60 p-3 text-sm" : "rounded-lg border border-dashed border-amber-400/40 p-3 text-sm"}>
      <h2 className={isLinked ? "text-xs font-medium text-muted-foreground mb-3" : "text-xs font-medium text-amber-400/70 mb-3"}>
        X
      </h2>
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <XIcon className={isLinked ? "size-4 shrink-0 text-muted-foreground" : "size-4 shrink-0 text-amber-400"} />
          {isLinked ? (
            <span className="text-sm font-medium">{twitterHandle}</span>
          ) : (
            <EncryptedText
              text="@username"
              scrambleOnly
              scrambleOneChar
              className="text-sm text-amber-400"
            />
          )}
        </div>

        {isLinked ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="destructive"
                  size="xs"
                  disabled={disconnecting}
                />
              }
            >
              {disconnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Disconnect"
              )}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect X / Twitter?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will unlink your X account (@{twitterHandle}) from your profile.
                  You can always reconnect later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  type="button"
                  variant="destructive"
                  onClick={handleDisconnect}
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            size="xs"
            onClick={handleConnect}
            className="bg-amber-400/15 text-amber-400 hover:bg-amber-400/25"
          >
            Connect
          </Button>
        )}
      </div>
    </div>
  )
}

function ConnectedAccountsSection() {
  const { data: session } = useSession()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Social accounts</CardTitle>
        <CardDescription>Manage your linked social accounts.</CardDescription>
      </CardHeader>

      <CardContent className="px-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/60 p-3 text-sm">
            <h2 className="text-xs font-medium text-muted-foreground mb-3">Discord</h2>
            <div className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <DiscordIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {session?.user?.discordHandle ?? session?.user?.name ?? "Connected"}
                </span>
              </div>
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500">Primary</Badge>
            </div>
          </div>

          <TwitterAccountRow />

          <div className="rounded-lg border border-dashed border-amber-400/40 p-3 text-sm">
            <h2 className="text-xs font-medium text-amber-400/70 mb-3">GitHub</h2>
            <div className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <GitHubIcon className="size-4 shrink-0 text-amber-400" />
                <EncryptedText
                  text="@username"
                  scrambleOnly
                  scrambleOneChar
                  className="text-sm text-amber-400"
                />
              </div>
              <Button
                size="xs"
                disabled
                className="bg-amber-400/15 text-amber-400 hover:bg-amber-400/25"
              >
                Coming soon
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// === CONTACT SECTION ===

const CONTACT_OPTIONS = [
  { value: "", label: "None" },
  { value: "discord", label: "Discord" },
  { value: "telegram", label: "Telegram" },
  { value: "x", label: "X" },
  { value: "email", label: "Email" },
] as const

function ContactSection({
  form,
}: {
  form: ReturnType<typeof useForm<SettingsValues>>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact</CardTitle>
        <CardDescription>How people can best reach you.</CardDescription>
      </CardHeader>

      <CardContent>
        <FormField<SettingsValues, "contactPreference">
          name="contactPreference"
          label="Preferred way of contact"
          description="This will be visible on your profile."
          render={({ field }) => (
            <RadioGroup value={field.value ?? ""} onValueChange={field.onChange}>
              {CONTACT_OPTIONS.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer text-sm">
                  <RadioGroupItem value={value} />
                  {label}
                </label>
              ))}
            </RadioGroup>
          )}
        />
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
      languages: [],
      skills: [],
      tools: [],
      image: "",
      contactPreference: "",
    },
    mode: "onBlur",
  })

  const links = useFieldArray({ control: form.control, name: "links" })
  const { languageOptions, languageQuery, setLanguageQuery, addLanguageOption } = useLanguagesState()
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
        languages: Array.isArray(userData.languages) ? userData.languages : [],
        skills: Array.isArray(userData.skills) ? userData.skills : [],
        tools: Array.isArray(userData.tags) ? userData.tags : [],
        image: userData.image ?? "",
        contactPreference: (userData.contactPreference ?? "") as SettingsValues["contactPreference"],
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

    const trimmedHandle = values.handle.trim()

    const payload = {
      // Only send handle when it actually changed to avoid re-claiming the same one.
      ...(trimmedHandle !== handle ? { handle: trimmedHandle } : {}),
      name: optionalString(values.name)!,
      headline: optionalString(values.headline),
      bio: optionalString(values.bio),
      location: optionalString(values.location),
      links: normalizeLinks(values.links),
      languages: normalizeStringArray(values.languages),
      skills: normalizeStringArray(values.skills),
      tags: normalizeStringArray(values.tools),
      image: optionalString(values.image) ?? null,
      contactPreference: values.contactPreference || null,
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

  if (isOwner === null || loading) {
    return <SettingsSkeleton />
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <Form form={form} onSubmit={handleSubmit}>
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
                View
              </Button>
              <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
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

        <ConnectedAccountsSection />

        <WalletLinkSection />

        <ContactSection form={form} />

        <ProfileSection
          form={form}
          onAvatarError={handleAvatarError}
          currentHandle={handle}
        />

        <AboutSection form={form} />

        <CountryLanguageSection
          form={form}
          countryItems={countryItems}
          languageOptions={languageOptions}
          languageQuery={languageQuery}
          onLanguageQueryChange={setLanguageQuery}
          onAddLanguage={addLanguageOption}
        />

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

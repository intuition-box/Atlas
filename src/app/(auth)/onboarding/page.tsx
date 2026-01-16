"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useFieldArray } from "react-hook-form"
import { useRouter, useSearchParams } from "next/navigation"
import { getSession, signOut } from "next-auth/react"

import { apiPost } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"
import { makeHandleCandidate, normalizeHandle, validateHandle } from "@/lib/handle"
import { ROUTES, userPath } from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { SKILLS } from "@/config/skills"
import { TOOLS } from "@/config/tools"

import { Button } from "@/components/ui/button"
import { Form, FormActions, FormField, FormMessage, fieldControlProps, useForm } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AvatarDropzone } from "@/components/common/avatar-dropzone"
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

const OnboardingSchema = z.object({
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

type OnboardingValues = z.infer<typeof OnboardingSchema>

type OnboardResponse = {
  user: {
    handle: string
  }
}

export default function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const returnToUrl = searchParams.get("returnToUrl") || ""

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(OnboardingSchema),
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

  const watchedHandle = form.watch("handle")
  const watchedName = form.watch("name")
  const normalizedHandle = watchedHandle.trim() ? normalizeHandle(watchedHandle) : ""

  const links = useFieldArray({ control: form.control, name: "links" })

  const [toolOptions, setToolOptions] = React.useState<string[]>(() => [...TOOLS])
  const [skillQuery, setSkillQuery] = React.useState("")
  const [toolQuery, setToolQuery] = React.useState("")



  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      const session = await getSession()
      const url = session?.user?.image
      if (!url) return
      if (cancelled) return

      // Only prefill if the user hasn’t chosen an image yet.
      if (!String(form.getValues("image") || "").trim()) {
        form.setValue("image", url, { shouldDirty: false })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [form])

  function applySuggestion() {
    if (String(form.getValues("handle") || "").trim()) return

    const suggested = makeHandleCandidate(watchedName || "")
    if (suggested) {
      form.setValue("handle", suggested, { shouldDirty: true, shouldTouch: true })
      form.clearErrors("handle")
    }
  }

  function opt(value: string | undefined | null): string | undefined {
    const v = String(value ?? "").trim()
    return v ? v : undefined
  }


  async function onSubmit(values: OnboardingValues) {
    form.clearErrors("root")

    const handleRes = validateHandle(values.handle)
    if (!handleRes.ok) {
      form.setError("handle", {
        type: "validate",
        message: handleRes.error.issues?.[0]?.message || handleRes.error.message,
      })
      return
    }

    const payload = {
      handle: handleRes.value,
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

    const result = await apiPost<OnboardResponse>("/api/user/onboard", payload)

    if (result.ok) {
      const next = returnToUrl.startsWith("/") ? returnToUrl : userPath(result.value.user.handle)
      router.replace(next)
      router.refresh()
      return
    }

    const err = result.error
    const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)

    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      // Only set errors for fields that exist on the form.
      if (key in form.getValues()) {
        form.setError(key as keyof OnboardingValues, { type: "server", message })
      }
    }

    const conflictHandle =
      parsed.code === "HANDLE_CONFLICT" &&
      parsed.meta &&
      typeof parsed.meta === "object" &&
      "currentHandle" in parsed.meta
        ? String((parsed.meta as Record<string, unknown>).currentHandle)
        : null

    form.setError("root", {
      type: "server",
      message:
        parsed.formError ||
        (conflictHandle
          ? `You’ve already claimed @${conflictHandle}.`
          : "We couldn’t finish onboarding. Try again."),
    })
  }

  async function onLogout() {
    await signOut({ redirect: false })
    router.replace(ROUTES.signIn)
    router.refresh()
  }

  const rootError = form.formState.errors.root?.message

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Finish setup</h1>
        <p className="text-sm text-muted-foreground">
          Pick a handle and a few profile details. You can change these later.
        </p>
      </header>

      {rootError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <FormMessage className="text-destructive">{rootError}</FormMessage>
        </div>
      ) : null}

      <Form form={form} onSubmit={onSubmit} className="flex flex-col gap-12">
        <div className="flex flex-col gap-10">
            <Field data-slot="onboarding-avatar" name="image" invalid={!!form.formState.errors.image}>
              <FieldLabel>Avatar</FieldLabel>
              <FieldDescription>
                We’ll use your OAuth photo by default. Drop an image on the avatar to replace it.
              </FieldDescription>

              <AvatarDropzone
                value={String(form.watch("image") || "") || null}
                alt="Avatar"
                fallback={(watchedName || "?").slice(0, 1).toUpperCase()}
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
            <FormField<OnboardingValues, "name">
              name="name"
              label="Name"
              required
              description="Often your legal name or how people call you"
              render={({ id, field, fieldState }) => (
                <Input {...fieldControlProps(field, { id, invalid: fieldState.invalid })} value={field.value ?? ""} />
              )}
            />

            <FormField<OnboardingValues, "handle">
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

            <FormField<OnboardingValues, "headline">
              name="headline"
              label="Headline"
              description="A short description that appears below your name in cards and tooltips"
              render={({ id, field, fieldState }) => (
                <Input {...fieldControlProps(field, { id, invalid: fieldState.invalid })} value={field.value ?? ""} />
              )}
            />

            <FormField<OnboardingValues, "location">
              name="location"
              label="Location"
              description="Where you’re based (city, country, etc.)"
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
                      <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">
                        No countries found.
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
                  </Combobox>
                )
              }}
            />

            <FormField<OnboardingValues, "bio">
              name="bio"
              label="Bio"
              description="A longer description about you"
              render={({ id, field, fieldState }) => (
                <Textarea
                  {...fieldControlProps(field, { id, invalid: fieldState.invalid })}
                  value={String(field.value ?? "")}
                  rows={5}
                  className="bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 flex w-full min-w-0 rounded-2xl border px-3 py-2 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-[3px] aria-invalid:ring-[3px]"
                />
              )}
            />

            <Field data-slot="onboarding-skills" name="skills" invalid={!!form.formState.errors.skills}>
              <FieldLabel>Skills</FieldLabel>
              <FieldDescription>Pick from the list (type to filter). You can add multiple.</FieldDescription>

              <FormField<OnboardingValues, "skills">
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
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <ComboboxInput id={id} placeholder="Add a skill…" className="w-full" showClear showTrigger />
                        </div>
                      </div>

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

            <Field data-slot="onboarding-tools" name="tools" invalid={!!form.formState.errors.tools}>
              <FieldLabel>Tools</FieldLabel>
              <FieldDescription>Pick from suggestions (type to filter) or press Enter to add a new tool.</FieldDescription>

              <FormField<OnboardingValues, "tools">
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
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
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
                        </div>
                      </div>

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

            <Field data-slot="onboarding-links" name="links" invalid={!!form.formState.errors.links}>
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

              {typeof form.formState.errors.links?.message === "string" ? (
                <FieldError>{form.formState.errors.links.message}</FieldError>
              ) : null}
            </Field>
          </div>

        <FormActions className="flex items-center gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Continue"}
          </Button>
          <Button type="button" variant="link" onClick={onLogout}>
            Log out
          </Button>
        </FormActions>
      </Form>
    </main>
  )
}

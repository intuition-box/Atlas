"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { apiGet } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

type UserGetResponse = {
  user: {
    id: string
    handle: string | null
    name: string | null
    image: string | null
    avatarUrl: string | null
    headline: string | null
    bio: string | null
    location: string | null
    links: string[] | null
    skills: string[] | null
    tags: string[] | null
    createdAt: string
  }
  isSelf: boolean
  attestations: Array<{
    id: string
    communityId: string
    type: string
    note: string | null
    createdAt: string
    fromUser: {
      id: string
      name: string | null
      handle: string | null
      image: string | null
      avatarUrl: string | null
    }
    community: {
      id: string
      name: string
      handle: string | null
    }
  }>
}

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ready"; data: UserGetResponse }

function initials(nameOrHandle: string) {
  const s = nameOrHandle.trim()
  if (!s) return "?"

  const parts = s.split(/\s+/g).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase()
  }

  return s.slice(0, 2).toUpperCase()
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function safeUrl(input: string) {
  try {
    const url = new URL(input)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

export default function UserProfilePage() {
  const params = useParams<{ handle: string }>()
  const rawHandle = String(params?.handle ?? "")
  const handle = React.useMemo(() => normalizeHandle(rawHandle), [rawHandle])

  const [state, setState] = React.useState<LoadState>({ status: "idle" })

  React.useEffect(() => {
    const parsed = validateHandle(handle)
    if (!parsed.ok) {
      setState({ status: "not-found" })
      return
    }

    const controller = new AbortController()
    setState({ status: "loading" })

    void (async () => {
      const result = await apiGet<UserGetResponse>(
        "/api/user/get",
        { handle },
        { signal: controller.signal },
      )

      if (controller.signal.aborted) return

      if (result.ok) {
        setState({ status: "ready", data: result.value })
        return
      }

      if (result.error && typeof result.error === "object" && "status" in result.error) {
        const parsedErr = parseApiProblem(result.error)
        if (parsedErr.status === 404) {
          setState({ status: "not-found" })
          return
        }
        setState({ status: "error", message: parsedErr.formError || "Something went wrong." })
        return
      }

      const parsedErr = parseApiClientError(result.error)
      setState({ status: "error", message: parsedErr.formError || "Something went wrong." })
    })()

    return () => controller.abort()
  }, [handle])

  if (state.status === "loading" || state.status === "idle") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="flex items-start gap-4">
          <div className="bg-muted h-16 w-16 animate-pulse rounded-2xl" />
          <div className="flex-1">
            <div className="bg-muted h-6 w-56 animate-pulse rounded" />
            <div className="bg-muted mt-2 h-4 w-32 animate-pulse rounded" />
            <div className="bg-muted mt-3 h-4 w-72 animate-pulse rounded" />
          </div>
        </div>
      </main>
    )
  }

  if (state.status === "not-found") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-lg font-semibold">User not found</h1>
        <p className="text-muted-foreground mt-1 text-sm">We couldn’t find @{handle}.</p>
      </main>
    )
  }

  if (state.status === "error") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-lg font-semibold">Couldn’t load profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">{state.message}</p>
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => setState({ status: "idle" })}>
            Retry
          </Button>
        </div>
      </main>
    )
  }

  const { user, isSelf, attestations } = state.data

  const handleLabel = user.handle ?? handle
  const displayName = user.name?.trim() || handleLabel
  const avatarSrc = user.avatarUrl || user.image || ""

  const skills = (user.skills ?? []).filter(Boolean)
  const tags = (user.tags ?? []).filter(Boolean)
  const links = (user.links ?? []).map((l) => String(l || "").trim()).filter(Boolean)

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Avatar className="size-16 rounded-2xl">
            <AvatarImage src={avatarSrc} alt={displayName} />
            <AvatarFallback className="rounded-2xl">{initials(displayName)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{displayName}</h1>
            <p className="text-muted-foreground mt-1 text-sm">@{handleLabel}</p>

            {user.headline ? (
              <p className="text-muted-foreground mt-1 text-sm">{user.headline}</p>
            ) : null}

            <p className="text-muted-foreground mt-3 text-xs">Joined {fmtDate(user.createdAt)}</p>
          </div>
        </div>

        {isSelf ? (
          <Button asChild type="button" variant="secondary">
            <Link href={`/u/${handleLabel}/settings`}>Edit profile</Link>
          </Button>
        ) : null}
      </header>

      <section className="mt-6 rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground/80">Profile</h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/60 p-3">
            <div className="text-xs font-medium text-foreground/70">Handle</div>
            <div className="mt-1 text-sm text-foreground/80">@{handleLabel}</div>
          </div>

          {user.location ? (
            <div className="rounded-lg border border-border/60 p-3">
              <div className="text-xs font-medium text-foreground/70">Location</div>
              <div className="mt-1 text-sm text-foreground/80">{user.location}</div>
            </div>
          ) : null}

          {user.headline ? (
            <div className="rounded-lg border border-border/60 p-3 sm:col-span-2">
              <div className="text-xs font-medium text-foreground/70">Headline</div>
              <div className="mt-1 text-sm text-foreground/80">{user.headline}</div>
            </div>
          ) : null}

          <div className="rounded-lg border border-border/60 p-3">
            <div className="text-xs font-medium text-foreground/70">Joined</div>
            <div className="mt-1 text-sm text-foreground/80">{fmtDate(user.createdAt)}</div>
          </div>
        </div>
      </section>
      {skills.length ? (
        <section className="mt-6 rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground/80">Skills</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {skills.map((s) => (
              <span key={s} className="rounded-full border border-border px-2 py-1 text-foreground/70">
                {s}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {user.bio ? (
        <section className="mt-6 rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground/80">About</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{user.bio}</p>
        </section>
      ) : null}

      {links.length ? (
        <section className="mt-6 rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground/80">Links</h2>
          <div className="mt-3 space-y-2">
            {links.map((l) => {
              const href = safeUrl(l)
              return href ? (
                <a
                  key={l}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm text-foreground/80 underline underline-offset-2 hover:text-foreground"
                >
                  {href}
                </a>
              ) : (
                <div key={l} className="truncate text-sm text-foreground/60">
                  {l}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {tags.length ? (
        <section className="mt-6 rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground/80">Tools of the trade</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {tags.map((t) => (
              <span key={t} className="rounded-full border border-border px-2 py-1 text-foreground/70">
                {t}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground/80">Attestations</h2>

        {attestations.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">No attestations yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {attestations.map((a) => {
              const fromName = a.fromUser.name?.trim() || a.fromUser.handle || "Unknown"
              const fromAvatar = a.fromUser.avatarUrl || a.fromUser.image || ""

              return (
                <div key={a.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="size-7">
                        <AvatarImage src={fromAvatar} alt={fromName} />
                        <AvatarFallback>{initials(fromName)}</AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 text-sm">
                        <span className="font-medium text-foreground">{fromName}</span>
                        <span className="text-foreground/60"> · {a.type}</span>
                      </div>
                    </div>

                    <div className="shrink-0 text-xs text-foreground/60">{fmtDate(a.createdAt)}</div>
                  </div>

                  {a.note ? <p className="mt-2 text-sm text-foreground/80">{a.note}</p> : null}

                  <div className="mt-2 text-xs text-foreground/60">
                    {a.community.handle ? (
                      <span>
                        In:{" "}
                        <Link
                          href={`/c/${a.community.handle}`}
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {a.community.name}
                        </Link>{" "}
                        <span className="text-foreground/60">@{a.community.handle}</span>
                      </span>
                    ) : (
                      <span>In: {a.community.name}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

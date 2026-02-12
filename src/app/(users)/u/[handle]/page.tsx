"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"

import { userPath, userSettingsPath } from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

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
    lastActiveAt: string | null
  }
  isSelf: boolean
  attestations: Array<{
    id: string
    type: string
    confidence: number | null
    createdAt: string
    fromUser: {
      id: string
      name: string | null
      handle: string | null
      image: string | null
      avatarUrl: string | null
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

function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return null

  const diff = Date.now() - ts
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
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
        const parsedErr = parseApiError(result.error)
        if (parsedErr.status === 404) {
          setState({ status: "not-found" })
          return
        }
        setState({ status: "error", message: parsedErr.formError || "Something went wrong." })
        return
      }

      const parsedErr = parseApiError(result.error)
      setState({ status: "error", message: parsedErr.formError || "Something went wrong." })
    })()

    return () => controller.abort()
  }, [handle])

  if (state.status === "loading" || state.status === "idle") {
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
        {[1, 2, 3].map((i) => (
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

  if (state.status === "not-found") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
        <Alert>
          <AlertDescription>We couldn&apos;t find @{handle}.</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <div>
          <Button type="button" variant="secondary" onClick={() => setState({ status: "idle" })}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (state.status !== "ready") {
    return null
  }

  const { user, isSelf, attestations } = state.data

  const handleLabel = user.handle ?? handle
  const displayName = user.name?.trim() || handleLabel
  const avatarSrc = user.avatarUrl || user.image || ""

  const skills = (user.skills ?? []).filter(Boolean)
  const tags = (user.tags ?? []).filter(Boolean)
  const links = (user.links ?? []).map((l) => String(l || "").trim()).filter(Boolean)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
      <PageHeader
        leading={
          <Avatar className="h-12 w-12">
            <AvatarImage src={avatarSrc} alt={displayName} />
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>
        }
        title={displayName}
        description={userPath(handleLabel)}
        sticky={false}
        actions={
          isSelf ? (
            <Button type="button" variant="secondary">
              <Link href={userSettingsPath(handleLabel)}>Edit profile</Link>
            </Button>
          ) : null
        }
        actionsAsFormActions={false}
      />

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <div className="flex flex-col gap-3">
            {/* Row 1: Joined + Last Active */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Joined</div>
                <div className="mt-1 text-sm text-foreground/80">{fmtDate(user.createdAt)}</div>
              </div>

              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Last seen</div>
                <div className="mt-1 text-sm text-foreground/80">
                  {formatRelativeTime(user.lastActiveAt) ?? "Never"}
                </div>
              </div>
            </div>

            {/* Row 2: Headline + Location (conditional) */}
            {(user.headline || user.location) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {user.headline ? (
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-xs font-medium text-foreground/70">Headline</div>
                    <div className="mt-1 text-sm text-foreground/80">{user.headline}</div>
                  </div>
                ) : null}

                {user.location ? (
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-xs font-medium text-foreground/70">Location</div>
                    <div className="mt-1 text-sm text-foreground/80">{user.location}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Row 3: Bio (full width) */}
            {user.bio ? (
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Bio</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{user.bio}</div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {links.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5">
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
          </CardContent>
        </Card>
      ) : null}

      {skills.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => (
                <Badge key={s} variant="secondary">{s}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {tags.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Tools of the trade</CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <Badge key={t} variant="secondary">{t}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Attestations</CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          {attestations.length === 0 ? (
            <Alert>
              <AlertDescription>No attestations yet.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {attestations.map((a) => {
                const fromName = a.fromUser.name?.trim() || a.fromUser.handle || "Unknown"
                const fromAvatar = a.fromUser.avatarUrl || a.fromUser.image || ""

                return (
                  <div key={a.id} className="rounded-lg border border-border/60 p-3">
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
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

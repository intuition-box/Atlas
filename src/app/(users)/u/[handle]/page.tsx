"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Wallet } from "lucide-react"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"
import { userSettingsPath } from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EncryptedText } from "@/components/ui/encrypted-text"
import { DiscordIcon, XIcon } from "@/components/ui/icons"
import { Skeleton } from "@/components/ui/skeleton"

// === TYPES ===

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
    discordId: string | null
    discordHandle: string | null
    twitterHandle: string | null
    walletAddresses: string[]
    createdAt: string
    lastActiveAt: string | null
  }
  isSelf: boolean
  attestations: Array<{
    id: string
    type: string
    confidence: number | null
    direction: "given" | "received"
    createdAt: string
    peer: {
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

// === HELPERS ===

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

function truncateAddress(address: string) {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// === LOADING SKELETON ===

function ProfileSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-7 pb-40">
      <div className="w-full flex flex-wrap gap-3 p-5">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex gap-3 ml-auto sm:align-center sm:justify-end">
            <Skeleton className="h-9 w-24" />
        </div>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle>
            <Skeleton className="h-5 w-24" />
          </CardTitle>
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
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full col-span-2" />
        </CardContent>
      </Card>

      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardHeader className="gap-4">
            <CardTitle>
              <Skeleton className="h-5 w-24" />
            </CardTitle>
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

function SocialsCard({ user }: { user: UserGetResponse["user"] }) {
  const hasDiscord = !!user.discordId
  const hasTwitter = !!user.twitterHandle
  const wallets = user.walletAddresses ?? []
  const hasSocials = hasDiscord || hasTwitter || wallets.length > 0

  if (!hasSocials) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Socials</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {hasDiscord && (
            <div className="rounded-lg border border-border/60 p-3 text-sm">
              <h2 className="text-xs font-medium text-muted-foreground mb-3">Discord</h2>
              <div className="flex items-center gap-2">
                <DiscordIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {user.discordHandle ?? user.name ?? "Connected"}
                </span>
              </div>
            </div>
          )}

          {hasTwitter && (
            <a
              href={`https://x.com/${user.twitterHandle}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border/60 p-3 text-sm transition-colors hover:border-accent/20 hover:text-accent group"
            >
              <h2 className="text-xs font-medium text-muted-foreground mb-3 group-hover:transition-colors group-hover:text-accent">X</h2>
              <div className="flex items-center gap-2">
                <XIcon className="size-4 shrink-0 text-muted-foreground group-hover:transition-colors group-hover:text-accent" />
                <span className="text-sm font-medium">@{user.twitterHandle}</span>
              </div>
            </a>
          )}

          {wallets.map((addr) => (
            <div key={addr} className="rounded-lg border border-border/60 p-3 text-sm">
              <h2 className="text-xs font-medium text-muted-foreground mb-3">Wallet</h2>
              <div className="flex items-center gap-2">
                <Wallet className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-mono text-sm">
                  <EncryptedText
                    text={truncateAddress(addr)}
                    revealDelayMs={40}
                    flipDelayMs={30}
                    className="inline"
                  />
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// === PAGE ===

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
    return <ProfileSkeleton />
  }

  if (state.status === "not-found") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
        <Alert>
          <AlertDescription>We couldn&apos;t find @{handle}.</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
      <PageHeader
        leading={
          <Avatar className="h-12 w-12">
            <AvatarImage src={avatarSrc} alt={displayName} />
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>
        }
        title={displayName}
        description={`@${handleLabel}`}
        sticky={false}
        actions={
          isSelf ? (
            <Button>
              <Link href={userSettingsPath(handleLabel)}>Edit profile</Link>
            </Button>
          ) : null
        }
        actionsAsFormActions={false}
      />

      <SocialsCard user={user} />

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <h2 className="text-xs font-medium text-muted-foreground mb-3">Joined</h2>
                <p className="text-sm font-medium">{fmtDate(user.createdAt)}</p>
              </div>

              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <h2 className="text-xs font-medium text-muted-foreground mb-3">Last seen</h2>
                <p className="text-sm font-medium">{formatRelativeTime(user.lastActiveAt) ?? "Never"}</p>
              </div>
            </div>

            {(user.headline || user.location) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {user.headline ? (
                  <div className="rounded-lg border border-border/60 p-3 text-sm">
                    <h2 className="text-xs font-medium text-muted-foreground mb-3">Headline</h2>
                    <p className="text-sm font-medium">{user.headline}</p>
                  </div>
                ) : null}

                {user.location ? (
                  <div className="rounded-lg border border-border/60 p-3 text-sm">
                    <h2 className="text-xs font-medium text-muted-foreground mb-3">Location</h2>
                    <p className="text-sm font-medium">{user.location}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {user.bio ? (
              <div className="rounded-lg border border-border/60 p-3">
                <h2 className="text-xs font-medium text-muted-foreground mb-3">Bio</h2>
                <p className="text-sm font-medium">{user.bio}</p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {links.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Portfolio</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
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
          <CardContent>
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
            <CardTitle>Tools</CardTitle>
          </CardHeader>
          <CardContent>
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
          {attestations.length > 0 && (
            <CardDescription>
              {attestations.filter((a) => a.direction === "received").length} received · {attestations.filter((a) => a.direction === "given").length} given
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {attestations.length === 0 ? (
            <Alert>
              <AlertDescription>No attestations yet.</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-3">
              {attestations.map((a) => {
                const peerName = a.peer.name?.trim() || a.peer.handle || "Unknown"
                const peerAvatar = a.peer.avatarUrl || a.peer.image || ""
                const isReceived = a.direction === "received"

                return (
                  <div key={a.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <ProfileAvatar type="user" src={peerAvatar} name={peerName} size="sm" />

                        <div className="min-w-0 text-sm">
                          <span className="font-medium truncate">{peerName}</span>
                          <span className="text-muted-foreground"> · {a.type}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="secondary"
                          className={isReceived
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-amber-500/10 text-amber-500"
                          }
                        >
                          {isReceived ? "Received" : "Given"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{fmtDate(a.createdAt)}</span>
                      </div>
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

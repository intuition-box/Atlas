"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"

import { userSettingsPath } from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EncryptedText } from "@/components/ui/encrypted-text"
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

// === SOCIAL ICONS ===

function DiscordIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  )
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function WalletIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  )
}

function truncateAddress(address: string) {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

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
      <CardContent className="px-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {hasDiscord && (
            <div className="flex items-center gap-3 rounded-lg border border-border/60 p-4">
              <DiscordIcon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Discord</p>
                <p className="text-xs text-muted-foreground">
                  {user.discordHandle ?? user.name ?? "Connected"}
                </p>
              </div>
            </div>
          )}

          {hasTwitter && (
            <a
              href={`https://x.com/${user.twitterHandle}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg border border-border/60 p-4 transition-colors hover:border-foreground/20 hover:bg-accent"
            >
              <XIcon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">X / Twitter</p>
                <p className="text-xs text-muted-foreground">@{user.twitterHandle}</p>
              </div>
            </a>
          )}

          {wallets.map((addr) => (
            <div key={addr} className="flex items-center gap-3 rounded-lg border border-border/60 p-4">
              <WalletIcon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Ethereum Wallet</p>
                <p className="text-xs font-mono text-muted-foreground">
                  <EncryptedText
                    text={truncateAddress(addr)}
                    revealDelayMs={40}
                    flipDelayMs={30}
                    className="inline"
                  />
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
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
        description={`@${handleLabel}`}
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

      <SocialsCard user={user} />

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

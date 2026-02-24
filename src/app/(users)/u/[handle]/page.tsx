"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowUpRight, Wallet } from "lucide-react"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"
import { userPath, userSettingsPath, userAttestationsPath } from "@/lib/routes"

import { AttestationBadge } from "@/components/attestation/badge"
import { AttestationButtons } from "@/components/attestation/buttons"
import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EncryptedText } from "@/components/ui/encrypted-text"
import { DiscordIcon, GitHubIcon, XIcon } from "@/components/ui/icons"
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
    languages: string[] | null
    contactPreference: string | null
    discordId: string | null
    discordHandle: string | null
    twitterHandle: string | null
    githubHandle: string | null
    walletAddresses: string[]
    linkedProviders: string[]
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

/** Ensures the string is a valid http(s) URL, prepending https:// for bare domains. */
function safeUrl(input: string): string | null {
  const raw = /^https?:\/\//i.test(input) ? input : `https://${input}`
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

/** Strips protocol and trailing slash for display (e.g. "https://wave.so/" → "wave.so"). */
function displayUrl(input: string): string {
  return input.replace(/^https?:\/\//i, "").replace(/\/+$/, "")
}

function truncateAddress(address: string) {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

const CONTACT_LABELS: Record<string, string> = {
  discord: "Discord",
  telegram: "Telegram",
  x: "X",
  email: "Email",
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
          <Skeleton className="h-9 w-64 rounded-4xl" />
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
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full" />
          <Skeleton className="h-19 w-full col-span-2" />
        </CardContent>
      </Card>

      {[1, 2, 3].map((i) => (
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

function SocialsCard({ user }: { user: UserGetResponse["user"] }) {
  const wallets = user.walletAddresses ?? []
  const hasDiscord = !!user.discordHandle
  const hasTwitter = !!user.twitterHandle
  const hasGitHub = !!user.githubHandle
  const hasSocials = hasDiscord || hasTwitter || hasGitHub || wallets.length > 0

  if (!hasSocials) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Socials</CardTitle>
        <CardDescription>Linked accounts and wallets.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {hasDiscord && (
            <div className="rounded-lg border border-border/60 p-3 text-sm">
              <h2 className="text-xs font-medium text-muted-foreground mb-3">Discord</h2>
              <div className="flex items-center gap-2">
                <DiscordIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{user.discordHandle}</span>
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

          {hasGitHub && (
            <a
              href={`https://github.com/${user.githubHandle}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border/60 p-3 text-sm transition-colors hover:border-accent/20 hover:text-accent group"
            >
              <h2 className="text-xs font-medium text-muted-foreground mb-3 group-hover:transition-colors group-hover:text-accent">GitHub</h2>
              <div className="flex items-center gap-2">
                <GitHubIcon className="size-4 shrink-0 text-muted-foreground group-hover:transition-colors group-hover:text-accent" />
                <span className="text-sm font-medium">{user.githubHandle}</span>
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
  const languages = (user.languages ?? []).filter(Boolean)
  const links = (user.links ?? []).map((l) => String(l || "").trim()).filter(Boolean)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar type="user" src={avatarSrc} name={displayName} className="h-12 w-12" />
        }
        title={displayName}
        description={`@${handleLabel}`}
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            nav={[
              { label: "Profile", href: userPath(handleLabel) },
              { label: "Attestations", href: userAttestationsPath(handleLabel) },
              ...(isSelf ? [{ label: "Settings", href: userSettingsPath(handleLabel) }] : []),
            ]}
          />
        }
      />

      <SocialsCard user={user} />

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>Background and experience.</CardDescription>
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

            {(user.headline || user.contactPreference) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {user.headline ? (
                  <div className="rounded-lg border border-border/60 p-3 text-sm">
                    <h2 className="text-xs font-medium text-muted-foreground mb-3">Headline</h2>
                    <p className="text-sm font-medium">{user.headline}</p>
                  </div>
                ) : null}

                {user.contactPreference ? (
                  <div className="rounded-lg border border-border/60 p-3 text-sm">
                    <h2 className="text-xs font-medium text-muted-foreground mb-3">Preferred contact</h2>
                    <p className="text-sm font-medium">{CONTACT_LABELS[user.contactPreference] ?? user.contactPreference}</p>
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

      {(user.location || languages.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>Location & languages</CardTitle>
            <CardDescription>Where they&apos;re based and what they speak.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {user.location ? (
                <div className="rounded-lg border border-border/60 p-3 text-sm">
                  <h2 className="text-xs font-medium text-muted-foreground mb-3">Country</h2>
                  <p className="text-sm font-medium">{user.location}</p>
                </div>
              ) : null}

              {languages.length > 0 ? (
                <div className="rounded-lg border border-border/60 p-3 text-sm">
                  <h2 className="text-xs font-medium text-muted-foreground mb-3">Languages</h2>
                  <div className="flex flex-wrap gap-2">
                    {languages.map((l) => (
                      <Badge key={l} variant="secondary">{l}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {links.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Portfolio</CardTitle>
            <CardDescription>Website and public portfolio links.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
            {links.map((l) => {
              const href = safeUrl(l)
              return href ? (
                <Badge
                  key={l}
                  variant="secondary"
                  className="gap-1 text-primary"
                  render={<a href={href} target="_blank" rel="noreferrer" />}
                >
                  {displayUrl(l)}
                  <ArrowUpRight className="size-3" />
                </Badge>
              ) : (
                <Badge key={l} variant="secondary" className="text-muted-foreground">
                  {displayUrl(l)}
                </Badge>
              )
            })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {skills.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
            <CardDescription>What they&apos;re good at.</CardDescription>
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
            <CardDescription>What they work with.</CardDescription>
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

      {/* Recent Attestations */}
      <Card>
        <CardHeader>
          <CardTitle>Attestations</CardTitle>
          <CardDescription>
            {attestations.length > 0
              ? `${attestations.filter((a) => a.direction === "received").length} received · ${attestations.filter((a) => a.direction === "given").length} given`
              : "Reputation and trust signals."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Attest — only visible to other users */}
          {!isSelf && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Vouch for {user.name?.split(" ")[0] || `@${handleLabel}`}&apos;s skills and contributions
                </p>
                <AttestationButtons
                  toUserId={user.id}
                  toName={displayName}
                  toHandle={handleLabel}
                  toAvatarUrl={avatarSrc}
                  size="sm"
                />
              </CardContent>
            </Card>
          )}

          {attestations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No attestations yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {attestations.slice(0, 10).map((a) => {
                const peerName = a.peer.name?.trim() || a.peer.handle || "Unknown"
                const peerAvatar = a.peer.avatarUrl || a.peer.image || ""
                const isReceived = a.direction === "received"

                return (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {a.peer.handle ? (
                          <Link href={userPath(a.peer.handle)} className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
                            <ProfileAvatar type="user" src={peerAvatar} name={peerName} size="sm" />
                            <span className="text-sm font-medium truncate">{peerName}</span>
                            <AttestationBadge type={a.type} />
                          </Link>
                        ) : (
                          <>
                            <ProfileAvatar type="user" src={peerAvatar} name={peerName} size="sm" />
                            <span className="text-sm font-medium truncate">{peerName}</span>
                            <AttestationBadge type={a.type} />
                          </>
                        )}
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
                )
              })}

              <Button variant="default" className="self-center" render={<Link href={userAttestationsPath(handleLabel)} />}>
                {attestations.length > 10
                  ? `View all ${attestations.length} attestations`
                  : "View all attestations"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

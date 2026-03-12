"use client"

import { useMemo } from "react"
import { useSession } from "next-auth/react"
import { ArrowUpRight, Wallet } from "lucide-react"

import { AttestationButtons } from "@/components/attestation/buttons"
import { useTourTrigger } from "@/hooks/use-tour-trigger"
import { createFirstEndorsementTour } from "@/components/tour/tour-definitions"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EncryptedText } from "@/components/ui/encrypted-text"
import { DiscordIcon, GitHubIcon, XIcon } from "@/components/ui/icons"
import { Skeleton } from "@/components/ui/skeleton"

import { useUser } from "./user-provider"
import type { UserData } from "./user-provider"

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

/** Strips protocol and trailing slash for display (e.g. "https://wave.so/" -> "wave.so"). */
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

function ContentSkeleton() {
  return (
    <>
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
    </>
  )
}

// === SUB-COMPONENTS ===

function SocialsCard({ user }: { user: UserData["user"] }) {
  const wallets = user.walletAddresses ?? []
  const hasDiscord = !!user.discordHandle
  const hasTwitter = !!user.twitterHandle
  const hasGitHub = !!user.githubHandle
  const hasSocials = hasDiscord || hasTwitter || hasGitHub || wallets.length > 0

  if (!hasSocials) return null

  return (
    <Card data-tour="socials-card">
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
  const ctx = useUser()
  const { status, data, user, isSelf, handle } = ctx
  const { data: session } = useSession()
  const viewerHandle = session?.user?.handle ?? null

  // Tour: "First Endorsement" — triggers on first visit to another user's profile
  const endorsementTour = useMemo(
    () => (!isSelf && status === "ready" ? createFirstEndorsementTour(viewerHandle) : null),
    [isSelf, status, viewerHandle],
  )
  useTourTrigger(endorsementTour)

  if (status === "loading") {
    return <ContentSkeleton />
  }

  if (status !== "ready" || !user || !data) {
    return null
  }

  const handleLabel = user.handle ?? handle
  const displayName = user.name?.trim() || handleLabel
  const avatarSrc = user.avatarUrl || user.image || ""

  const skills = (user.skills ?? []).filter(Boolean)
  const tags = (user.tags ?? []).filter(Boolean)
  const languages = (user.languages ?? []).filter(Boolean)
  const links = (user.links ?? []).map((l) => String(l || "").trim()).filter(Boolean)

  return (
    <>
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
                <Badge key={l} variant="default">
                  {displayUrl(l)}
                </Badge>
              )
            })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {(skills.length || tags.length) ? (
        <div data-tour="skills-tools-section" className="flex flex-col gap-6 rounded-2xl">
          {skills.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
                <CardDescription>What they&apos;re good at.{!isSelf && " Click to endorse."}</CardDescription>
              </CardHeader>
              <CardContent>
                <AttestationButtons
                  items={skills}
                  endorsementType="SKILL_ENDORSE"
                  toUserId={user.id}
                  toName={displayName}
                  toHandle={handleLabel}
                  toAvatarUrl={avatarSrc}
                  isSelf={isSelf}
                  source="profile"
                />
              </CardContent>
            </Card>
          ) : null}

          {tags.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Tools</CardTitle>
                <CardDescription>What they work with.{!isSelf && " Click to endorse."}</CardDescription>
              </CardHeader>
              <CardContent>
                <AttestationButtons
                  items={tags}
                  endorsementType="TOOL_ENDORSE"
                  toUserId={user.id}
                  toName={displayName}
                  toHandle={handleLabel}
                  toAvatarUrl={avatarSrc}
                  isSelf={isSelf}
                  source="profile"
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* Network — only visible to other users */}
      {!isSelf && (
        <Card data-tour="network-card">
          <CardHeader>
            <CardTitle>Network</CardTitle>
            <CardDescription>How do you know @{handleLabel}?</CardDescription>
          </CardHeader>
          <CardContent>
            <AttestationButtons
              toUserId={user.id}
              toName={displayName}
              toHandle={handleLabel}
              toAvatarUrl={avatarSrc}
              source="profile"
            />
          </CardContent>
        </Card>
      )}
    </>
  )
}

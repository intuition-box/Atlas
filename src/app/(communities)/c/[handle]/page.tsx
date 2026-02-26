"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Globe } from "lucide-react"
import { useSession } from "next-auth/react"
import { DiscordIcon, GitHubIcon, TelegramIcon, XIcon } from "@/components/ui/icons"

import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"
import {
  communityJoinPath,
  communityActivityPath,
  communityMembersPath,
  communityOrbitPath,
  communityApplicationsPath,
  communityBansPath,
  communityPermissionsPath,
  communitySettingsPath,
  communityPath,
  userPath,
  ROUTES,
} from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// === TYPES ===

type CommunityGetResponse = {
  mode: "full" | "splash"
  community: {
    id: string
    handle: string
    name: string
    description: string | null
    avatarUrl: string | null
    createdAt: string
    isMembershipOpen: boolean
    isPublicDirectory: boolean
    discordUrl: string | null
    xUrl: string | null
    telegramUrl: string | null
    githubUrl: string | null
    websiteUrl: string | null
  }
  memberCount: number
  canViewDirectory: boolean
  isAdmin: boolean
  viewerMembership: {
    status: string
    role: string
  } | null
  orbitMembers: Array<{
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
    image: string | null
    orbitLevel: string
    headline: string | null
  }>
}

type CommunityLoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ready"; data: CommunityGetResponse }

// === HELPERS ===

function fmtDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

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

const SOCIAL_BASES: Record<string, string> = {
  discordUrl: "discord.gg/",
  xUrl: "x.com/",
  githubUrl: "github.com/",
  telegramUrl: "t.me/",
}

/** Extracts a display handle from a full URL (e.g. "https://x.com/wavedotso" → "wavedotso"). */
function displaySocialHandle(key: string, url: string): string {
  const base = SOCIAL_BASES[key]
  if (base) {
    const stripped = url.replace(/^https?:\/\//i, "")
    if (stripped.toLowerCase().startsWith(base.toLowerCase())) {
      const handle = stripped.slice(base.length).replace(/\/+$/, "")
      if (handle) return handle
    }
  }
  return displayUrl(url)
}

const SOCIAL_LINKS = [
  { key: "discordUrl", label: "Discord", icon: DiscordIcon },
  { key: "xUrl", label: "X", icon: XIcon },
  { key: "githubUrl", label: "GitHub", icon: GitHubIcon },
  { key: "telegramUrl", label: "Telegram", icon: TelegramIcon },
  { key: "websiteUrl", label: "Website", icon: Globe },
] as const

// === JOIN BANNER ===

function usePageHeaderHeight() {
  const [height, setHeight] = React.useState(0)

  React.useEffect(() => {
    const header = document.querySelector("[data-slot='page-header']") as HTMLElement | null
    if (!header) return

    const measure = () => setHeight(header.offsetHeight)
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])

  return height
}

function JoinBanner({ name, handle, pending }: { name: string; handle: string; pending?: boolean }) {
  const inlineRef = React.useRef<HTMLDivElement>(null)
  const headerHeight = usePageHeaderHeight()
  const [showFixedBar, setShowFixedBar] = React.useState(false)

  React.useEffect(() => {
    const el = inlineRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => setShowFixedBar(!entry.isIntersecting),
      { threshold: 0, rootMargin: "0px 0px 0px 0px" },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const title = pending
    ? "Your application is pending review"
    : `${name} is accepting new members`

  const description = pending
    ? "You can reopen your application to edit and update your submission while it\u2019s being reviewed."
    : "Apply to join the community and connect with other members."

  const ctaLabel = pending ? "Update application" : "Apply to join"
  const ctaLabelCompact = pending ? `Update application` : `Apply to join ${name}`

  return (
    <>
      {/* Inline banner */}
      <section
        ref={inlineRef}
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border/60",
          "bg-gradient-to-b from-card/80 via-card/60 to-primary/5",
          "transition-opacity duration-300",
          showFixedBar && "opacity-0",
        )}
      >
        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <div>
            <h3 className="text-base font-semibold tracking-tight">
              {title}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          </div>
          <Button variant={pending ? "default" : "solid"} render={<Link href={communityJoinPath(handle)} />}>
            {ctaLabel}
          </Button>
        </div>
      </section>

      {/* Fixed sticky bar */}
      <div
        className={cn(
          "fixed left-0 right-0 z-30",
          "transition-all duration-300 ease-out",
          showFixedBar
            ? "translate-y-0 opacity-100"
            : "-translate-y-2 opacity-0 pointer-events-none",
        )}
        style={{ top: headerHeight > 0 ? `${headerHeight}px` : 0 }}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl items-center justify-center",
            "rounded-b-2xl border-x border-b border-border/60",
            "bg-gradient-to-br from-card/95 via-card/90 to-primary/10",
            "backdrop-blur-md shadow-md",
            "-mt-4 px-5 pb-3 pt-7",
          )}
        >
          <Button variant={pending ? "default" : "solid"} size="sm" render={<Link href={communityJoinPath(handle)} />}>
            {ctaLabelCompact}
          </Button>
        </div>
      </div>
    </>
  )
}

// === TEAM MEMBERS ===

type TeamMember = {
  id: string
  handle: string
  name: string | null
  image: string | null
  role: "OWNER" | "ADMIN"
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
}

function TeamMembers({ handle }: { handle: string }) {
  const [members, setMembers] = React.useState<TeamMember[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!handle) return

    const ac = new AbortController()

    void (async () => {
      // Fetch owners and admins in parallel
      const [ownersRes, adminsRes] = await Promise.all([
        apiGet<{ items: Array<{ membership: { role: string }; user: { id: string; handle: string | null; name: string | null; image: string | null; avatarUrl: string | null } }> }>(
          "/api/membership/list",
          { handle, role: "OWNER", limit: 10 },
          { signal: ac.signal },
        ),
        apiGet<{ items: Array<{ membership: { role: string }; user: { id: string; handle: string | null; name: string | null; image: string | null; avatarUrl: string | null } }> }>(
          "/api/membership/list",
          { handle, role: "ADMIN", limit: 20 },
          { signal: ac.signal },
        ),
      ])

      if (ac.signal.aborted) return

      const team: TeamMember[] = []
      const seen = new Set<string>()

      for (const res of [ownersRes, adminsRes]) {
        if (!res.ok) continue
        for (const item of res.value.items) {
          if (seen.has(item.user.id)) continue
          seen.add(item.user.id)
          team.push({
            id: item.user.id,
            handle: item.user.handle ?? "",
            name: item.user.name,
            image: item.user.avatarUrl ?? item.user.image,
            role: item.membership.role as "OWNER" | "ADMIN",
          })
        }
      }

      setMembers(team)
      setLoading(false)
    })()

    return () => { ac.abort() }
  }, [handle])

  if (loading || members.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Team</CardTitle>
            <CardDescription>The people behind this community.</CardDescription>
          </div>
          <Button variant="default" size="sm" render={<Link href={communityMembersPath(handle)} />}>
            View members
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {members.map((m) => {
            const displayName = m.name?.trim() || `@${m.handle}`
            const href = m.handle ? userPath(m.handle) : "#"
            return (
              <Link
                key={m.id}
                href={href}
                className="flex items-center gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:bg-card/50"
              >
                <ProfileAvatar type="user" src={m.image} name={displayName} className="h-8 w-8" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">@{m.handle}</div>
                </div>
                <Badge variant="info" className="ml-auto shrink-0">
                  {ROLE_LABELS[m.role] ?? m.role}
                </Badge>
              </Link>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// === PAGE ===

export default function CommunityProfilePage() {
  const router = useRouter()
  const { data: session } = useSession()
  const params = useParams<{ handle: string }>()
  const rawHandle = String(params?.handle ?? "")
  const handle = React.useMemo(() => normalizeHandle(rawHandle), [rawHandle])

  // --- Community data ---
  const [state, setState] = React.useState<CommunityLoadState>({ status: "idle" })

  React.useEffect(() => {
    const parsed = validateHandle(handle)
    if (!parsed.ok) {
      setState({ status: "not-found" })
      return
    }

    const controller = new AbortController()
    setState({ status: "loading" })

    void (async () => {
      const result = await apiGet<CommunityGetResponse>(
        "/api/community/get",
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

  // --- SKELETON ---

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
        {/* PageHeader skeleton */}
        <div className="w-full p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Skeleton className="size-12 rounded-full shrink-0" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-64 rounded-4xl" />
          </div>
        </div>

        {/* About skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- NOT FOUND ---

  if (state.status === "not-found") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
        <Alert>
          <AlertDescription>We couldn&apos;t find @{handle}.</AlertDescription>
        </Alert>
      </div>
    )
  }

  // --- ERROR ---

  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
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

  if (state.status !== "ready") return null

  // --- READY ---

  const { community, memberCount, isAdmin, viewerMembership } = state.data

  const handleLabel = community.handle ?? handle
  const avatarSrc = community.avatarUrl ?? ""

  const socials = SOCIAL_LINKS.filter((s) => community[s.key])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar
            type="community"
            src={avatarSrc}
            name={community.name}
            className="h-12 w-12"
          />
        }
        title={community.name}
        description={`@${handleLabel}`}
        sticky
        actions={
          <PageToolbar
            nav={[
              { label: "Profile", href: communityPath(handleLabel) },
              { label: "Orbit", href: communityOrbitPath(handleLabel) },
              { label: "Members", href: communityMembersPath(handleLabel) },
              { label: "Activity", href: communityActivityPath(handleLabel) },
            ]}
            overflow={isAdmin ? [
              { label: "Applications", href: communityApplicationsPath(handleLabel) },
              { label: "Bans", href: communityBansPath(handleLabel) },
              { label: "Permissions", href: communityPermissionsPath(handleLabel) },
              { label: "Settings", href: communitySettingsPath(handleLabel) },
            ] : undefined}
          />
        }
        actionsAsFormActions={false}
      />

      {/* Join banner for non-members when membership is open */}
      {viewerMembership?.status !== "APPROVED" && community.isMembershipOpen ? (
        <JoinBanner name={community.name} handle={handleLabel} pending={viewerMembership?.status === "PENDING"} />
      ) : null}

      {/* Social accounts */}
      {socials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Social accounts</CardTitle>
            <CardDescription>Where to find this community online.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {socials.map(({ key, label, icon: Icon }) => {
                const href = safeUrl(community[key]!)
                if (!href) return null
                return (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-border/60 p-3 text-sm transition-colors hover:border-accent/20 hover:text-accent group"
                  >
                    <h2 className="text-xs font-medium text-muted-foreground mb-3 group-hover:transition-colors group-hover:text-accent">{label}</h2>
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground group-hover:transition-colors group-hover:text-accent" />
                      <span className="text-sm font-medium">{displaySocialHandle(key, community[key]!)}</span>
                    </div>
                  </a>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>Community details and settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <h2 className="text-xs font-medium text-muted-foreground mb-3">Created</h2>
                <p className="text-sm font-medium">{fmtDate(community.createdAt)}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <h2 className="text-xs font-medium text-muted-foreground mb-3">Members</h2>
                <p className="text-sm font-medium">{memberCount}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <h2 className="text-xs font-medium text-muted-foreground mb-3">Visibility</h2>
                <p className="text-sm font-medium">{community.isPublicDirectory ? "Public" : "Private"}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <h2 className="text-xs font-medium text-muted-foreground mb-3">Membership</h2>
                <p className="text-sm font-medium">{community.isMembershipOpen ? "Open" : "Closed"}</p>
              </div>
            </div>

            {community.description ? (
              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <h2 className="text-xs font-medium text-muted-foreground mb-3">Description</h2>
                <p className="whitespace-pre-wrap text-sm font-medium">{community.description}</p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Team members */}
      <TeamMembers handle={handleLabel} />
    </div>
  )
}

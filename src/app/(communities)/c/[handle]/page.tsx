"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Globe, LayoutGrid, List, Lock, MoreVertical, RefreshCw } from "lucide-react"
import { DiscordIcon, GitHubIcon, TelegramIcon, XIcon } from "@/components/ui/icons"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"
import {
  communityApplyPath,
  communityOrbitPath,
  communityApplicationsPath,
  communitySettingsPath,
  communityPath,
  userPath,
  ROUTES,
} from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { SKILL_LIST as SKILLS, TOOL_LIST as TOOLS } from "@/lib/attestations/definitions"

import { PageHeader } from "@/components/common/page-header"
import { PageHeaderMenu } from "@/components/common/page-header-menu"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import { InfiniteScroll } from "@/components/ui/infinite-scroll"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// === CONSTANTS ===

const PAGE_SIZE = 50
const DEBOUNCE_DELAY = 300

// === TYPES (Community) ===

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

// === TYPES (Members) ===

type MemberRole = "OWNER" | "ADMIN" | "MOD" | "MEMBER"

type MemberProfile = {
  id: string
  handle: string
  name?: string | null
  headline?: string | null
  bio?: string | null
  location?: string | null
  image?: string | null
  links?: string[] | null
  skills?: string[] | null
  tools?: string[] | null
  languages?: string[] | null
  orbitLevel?: string | null
  orbitLevelOverride?: string | null
  love?: number | null
  reach?: number | null
  gravity?: number | null
}

type CommunityMember = {
  membershipId: string
  role: MemberRole
  status: string
  approvedAt?: string | null
  lastActiveAt?: string | null
  user: MemberProfile
}

type MembersResponse = {
  page: { nextCursor: string | null }
  members: CommunityMember[]
}

type FilterState = {
  q: string
  role: MemberRole | ""
  country: string
  skills: string[]
  tools: string[]
  headline: string
  bio: string
}

type QueryParams = {
  handle: string
  q?: string
  role?: string
  location?: string
  skills?: string
  tools?: string
  headline?: string
  bio?: string
  cursor?: string
  limit: number
}

type ApiMemberItem = {
  membership: {
    id: string
    role: MemberRole
    status: string
    orbitLevel: string | null
    orbitLevelOverride: string | null
    loveScore: number | null
    reachScore: number | null
    gravityScore: number | null
    approvedAt: string | null
    lastActiveAt: string | null
  }
  user: {
    id: string
    handle: string | null
    name: string | null
    image: string | null
    avatarUrl: string | null
    headline: string | null
    bio: string | null
    location: string | null
    skills: string[]
    tools: string[]
    links: string[]
    languages: string[]
  }
}

type ApiMembersResponse = {
  items: ApiMemberItem[]
  nextCursor: string | null
}

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

// === HELPERS (Members) ===

function normalizeMembersPayload(raw: unknown, _fallbackHandle: string): MembersResponse {
  const r = raw as ApiMembersResponse | null
  const nextCursor = r?.nextCursor ?? null
  const items = r?.items ?? []

  const members: CommunityMember[] = items.map((item) => ({
    membershipId: item.membership.id,
    role: item.membership.role,
    status: item.membership.status,
    approvedAt: item.membership.approvedAt,
    lastActiveAt: item.membership.lastActiveAt,
    user: {
      id: item.user.id,
      handle: item.user.handle ?? "",
      name: item.user.name,
      headline: item.user.headline,
      bio: item.user.bio,
      location: item.user.location,
      image: item.user.avatarUrl ?? item.user.image,
      links: item.user.links,
      skills: item.user.skills,
      tools: item.user.tools,
      languages: item.user.languages,
      orbitLevel: item.membership.orbitLevel,
      orbitLevelOverride: item.membership.orbitLevelOverride,
      love: item.membership.loveScore,
      reach: item.membership.reachScore,
      gravity: item.membership.gravityScore,
    },
  }))

  return { page: { nextCursor }, members }
}

function mergeMembersUnique(prev: CommunityMember[], next: CommunityMember[]): CommunityMember[] {
  const out: CommunityMember[] = []
  const seen = new Set<string>()
  for (const m of prev) {
    if (!m || seen.has(m.membershipId)) continue
    seen.add(m.membershipId)
    out.push(m)
  }
  for (const m of next) {
    if (!m || seen.has(m.membershipId)) continue
    seen.add(m.membershipId)
    out.push(m)
  }
  return out
}

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const s = v.trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

function optionalString(value: string | undefined | null): string | undefined {
  const v = (value ?? "").trim()
  return v || undefined
}

function asCsv(values: string[]): string | undefined {
  const v = uniqStrings(values)
  return v.length ? v.join(",") : undefined
}

function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ""
  return Intl.NumberFormat(undefined, { notation: "compact" }).format(n)
}

function buildQueryParams(communityHandle: string, filters: FilterState, cursor: string | null): QueryParams {
  return {
    handle: communityHandle,
    q: optionalString(filters.q),
    role: optionalString(filters.role),
    location: optionalString(filters.country),
    skills: asCsv(filters.skills),
    tools: asCsv(filters.tools),
    headline: optionalString(filters.headline),
    bio: optionalString(filters.bio),
    cursor: cursor ?? undefined,
    limit: PAGE_SIZE,
  }
}

function hasActiveFilters(filters: FilterState): boolean {
  return Boolean(
    filters.q ||
    filters.role ||
    filters.country ||
    filters.skills.length ||
    filters.tools.length ||
    filters.headline ||
    filters.bio
  )
}

// === HOOKS ===

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

function useMembersData(communityHandle: string, filters: FilterState, cursor: string | null) {
  const router = useRouter()
  const [data, setData] = React.useState<MembersResponse | null>(null)
  const [items, setItems] = React.useState<CommunityMember[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const debouncedQ = useDebouncedValue(filters.q, DEBOUNCE_DELAY)
  const debouncedHeadline = useDebouncedValue(filters.headline, DEBOUNCE_DELAY)
  const debouncedBio = useDebouncedValue(filters.bio, DEBOUNCE_DELAY)

  const queryObject = React.useMemo(() => {
    return buildQueryParams(
      communityHandle,
      { ...filters, q: debouncedQ, headline: debouncedHeadline, bio: debouncedBio },
      cursor
    )
  }, [
    communityHandle, debouncedQ, filters.role, filters.country,
    filters.skills, filters.tools, debouncedHeadline, debouncedBio, cursor,
  ])

  React.useEffect(() => {
    if (!communityHandle) return

    const ac = new AbortController()

    async function load() {
      setError(null)
      setLoading(cursor === null)
      setLoadingMore(cursor !== null)

      try {
        const res = await apiGet<MembersResponse>("/api/membership/list", queryObject, {
          signal: ac.signal,
        })

        if (ac.signal.aborted) return

        if (!res.ok) {
          if ("status" in res.error && res.error.status === 401) {
            router.replace(ROUTES.signIn)
            return
          }
          setError("We couldn't load members. Try again.")
          setLoading(false)
          setLoadingMore(false)
          return
        }

        const normalized = normalizeMembersPayload(res.value as unknown, communityHandle)
        setData(normalized)
        setItems((prev) => cursor ? mergeMembersUnique(prev, normalized.members) : normalized.members)
        setLoading(false)
        setLoadingMore(false)
      } catch {
        if (!ac.signal.aborted) {
          setError("An unexpected error occurred while loading members.")
          setLoading(false)
          setLoadingMore(false)
        }
      }
    }

    void load()
    return () => { ac.abort() }
  }, [router, queryObject, cursor, communityHandle])

  return { data, items, loading, loadingMore, error }
}

// === SUB-COMPONENTS (Members) ===

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-4xl bg-muted-foreground/10 px-2 py-1 text-xs font-medium">
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          className="-mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          onClick={onRemove}
          aria-label="Remove filter"
        >
          ×
        </button>
      )}
    </span>
  )
}

type FilterComboboxProps<T> = {
  label: string
  placeholder: string
  items: T[]
  value: T | null
  onValueChange: (value: T | null) => void
  inputValue?: string
  onInputValueChange?: (value: string) => void
  renderItem?: (item: T) => React.ReactNode
  emptyMessage?: string
  showClear?: boolean
  showTrigger?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

function FilterCombobox<T extends string>({
  label,
  placeholder,
  items,
  value,
  onValueChange,
  inputValue,
  onInputValueChange,
  renderItem,
  emptyMessage = "No items found.",
  showClear = true,
  showTrigger = true,
  onKeyDown,
}: FilterComboboxProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      {label && <div className="text-xs font-medium text-foreground/70">{label}</div>}
      <Combobox
        items={items}
        value={value}
        onValueChange={(v) => onValueChange(v as T | null)}
        inputValue={inputValue}
        onInputValueChange={onInputValueChange}
      >
        <ComboboxInput
          placeholder={placeholder}
          className="w-full"
          showClear={showClear}
          showTrigger={showTrigger}
          onKeyDown={onKeyDown}
        />
        <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
          <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</ComboboxEmpty>
          <ComboboxList className="max-h-64 overflow-auto">
            <ComboboxCollection>
              {(item: T) => (
                <ComboboxItem
                  key={item}
                  value={item}
                  className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
                >
                  <span className="flex-1">{renderItem ? renderItem(item) : item}</span>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MOD: "Mod",
  MEMBER: "Member",
}

function formatOrbitLevel(level: string | null | undefined): string | null {
  if (!level) return null
  // e.g. "EXPLORER" → "Explorer", "CONTRIBUTOR" → "Contributor"
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase()
}

const ORBIT_LEVELS = [
  { value: "EXPLORER", label: "Explorer" },
  { value: "PARTICIPANT", label: "Participant" },
  { value: "CONTRIBUTOR", label: "Contributor" },
  { value: "ADVOCATE", label: "Advocate" },
] as const

function AdminMemberMenu({
  member,
  communityHandle,
  onOrbitOverride,
}: {
  member: CommunityMember
  communityHandle: string
  onOrbitOverride: (userId: string, newOverride: string | null) => void
}) {
  const [banDialogOpen, setBanDialogOpen] = React.useState(false)
  const [banning, setBanning] = React.useState(false)

  const u = member.user
  const currentValue = u.orbitLevelOverride ?? "auto"
  const displayName = u.name?.trim() || `@${u.handle}`

  function handleOrbitChange(nextValue: unknown) {
    const next = String(nextValue)
    const nextOverride = next === "auto" ? null : next
    onOrbitOverride(u.id, nextOverride)

    void apiPost("/api/membership/orbit", {
      communityHandle,
      userId: u.id,
      orbitLevelOverride: nextOverride,
    })
  }

  async function handleBan() {
    setBanning(true)
    // TODO: wire to POST /api/membership/ban when implemented
    setBanning(false)
    setBanDialogOpen(false)
  }

  return (
    <>
      <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <Menu>
          <MenuTrigger
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-accent cursor-pointer"
            aria-label="Member actions"
          >
            <MoreVertical className="size-3.5" />
          </MenuTrigger>
          <MenuContent align="end" sideOffset={4}>
            <MenuGroup>
              <MenuLabel>Orbit level</MenuLabel>
              <MenuRadioGroup value={currentValue} onValueChange={handleOrbitChange}>
                <MenuRadioItem value="auto">Auto</MenuRadioItem>
                {ORBIT_LEVELS.map((l) => (
                  <MenuRadioItem key={l.value} value={l.value}>{l.label}</MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuLabel>Moderation</MenuLabel>
              <MenuItem variant="destructive" onClick={() => setBanDialogOpen(true)}>
                Ban member
              </MenuItem>
            </MenuGroup>
          </MenuContent>
        </Menu>
      </div>

      <AlertDialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban {displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove them from the community. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={banning} onClick={handleBan}>
              {banning ? "Banning\u2026" : "Ban member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MemberCard({ member, isAdmin, communityHandle, onOrbitOverride }: {
  member: CommunityMember
  isAdmin?: boolean
  communityHandle?: string
  onOrbitOverride?: (userId: string, newOverride: string | null) => void
}) {
  const u = member.user
  const displayName = u.name?.trim() || `@${u.handle}`
  const href = userPath(u.handle)

  const hasOrbit = u.love != null || u.reach != null || u.gravity != null
  const hasSkills = (u.skills?.length ?? 0) > 0
  const hasTools = (u.tools?.length ?? 0) > 0
  const languages = (u.languages ?? []).filter(Boolean)
  const hasLocationOrLangs = !!u.location || languages.length > 0

  const isOrbitOverridden = u.orbitLevelOverride != null
  const effectiveOrbit = u.orbitLevelOverride ?? u.orbitLevel
  const orbitLabel = formatOrbitLevel(effectiveOrbit)
  const showAdminMenu = isAdmin && communityHandle && onOrbitOverride

  return (
    <Card size="sm" className="transition-colors hover:bg-card/80">
      <CardHeader className="!gap-0">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} aria-label={`View ${displayName}'s profile`} className="flex items-start gap-3 min-w-0">
            <ProfileAvatar type="user" src={u.image} name={displayName} className="h-10 w-10" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="truncate text-sm font-medium">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">@{u.handle}</div>
            </div>
          </Link>
          <div className="flex items-center gap-1.5 shrink-0">
            {orbitLabel && (
              isOrbitOverridden ? (
                <Tooltip>
                  <TooltipTrigger>
                    <Badge variant="secondary" className="gap-2 bg-destructive/15 text-destructive">
                      <Lock className="size-2.5" />
                      {orbitLabel}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>Manually set by admin</TooltipContent>
                </Tooltip>
              ) : (
                <Badge variant="secondary">{orbitLabel}</Badge>
              )
            )}
            {member.role !== "MEMBER" && (
              <Badge variant="secondary" className="bg-amber-500/15 text-amber-600">{ROLE_LABELS[member.role]}</Badge>
            )}
            {showAdminMenu && (
              <AdminMemberMenu
                member={member}
                communityHandle={communityHandle}
                onOrbitOverride={onOrbitOverride}
              />
            )}
          </div>
        </div>
      </CardHeader>

      <Link href={href} className="contents">
        {hasOrbit && (
          <CardContent>
            <div className="grid grid-cols-3 divide-x divide-border/60 rounded-lg border border-border/60 py-2">
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-muted-foreground">Love</span>
                <span className="text-xs font-medium">{u.love != null ? formatCompact(u.love) : "\u2014"}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-muted-foreground">Reach</span>
                <span className="text-xs font-medium">{u.reach != null ? formatCompact(u.reach) : "\u2014"}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-muted-foreground">Gravity</span>
                <span className="text-xs font-medium">{u.gravity != null ? formatCompact(u.gravity) : "\u2014"}</span>
              </div>
            </div>
          </CardContent>
        )}

        {hasLocationOrLangs && (
          <CardContent>
            <h3 className="text-[11px] font-medium text-muted-foreground">Location & languages</h3>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {u.location && <Badge variant="secondary">{u.location}</Badge>}
              {languages.map((l) => (
                <Badge key={`l:${l}`} variant="secondary">{l}</Badge>
              ))}
            </div>
          </CardContent>
        )}

        {hasSkills && (
          <CardContent>
            <h3 className="text-[11px] font-medium text-muted-foreground">Skills</h3>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(u.skills || []).slice(0, 5).map((s) => (
                <Badge key={`s:${s}`} variant="secondary">{s}</Badge>
              ))}
            </div>
          </CardContent>
        )}

        {hasTools && (
          <CardContent>
            <h3 className="text-[11px] font-medium text-muted-foreground">Tools</h3>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(u.tools || []).slice(0, 5).map((t) => (
                <Badge key={`t:${t}`} variant="secondary">{t}</Badge>
              ))}
            </div>
          </CardContent>
        )}
      </Link>
    </Card>
  )
}

function MemberRow({ member }: { member: CommunityMember }) {
  const u = member.user
  const displayName = u.name?.trim() || `@${u.handle}`
  const href = userPath(u.handle)

  return (
    <Link
      href={href}
      className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-4 py-3 text-sm transition-colors hover:bg-card/50"
      aria-label={`View ${displayName}'s profile`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ProfileAvatar type="user" src={u.image} name={displayName} className="h-8 w-8" />
        <div className="min-w-0">
          <div className="truncate font-medium">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">@{u.handle}</div>
          {u.headline && <div className="truncate text-xs text-foreground/70">{u.headline}</div>}
        </div>
      </div>

      <div className="flex items-center">
        {member.role !== "MEMBER" ? (
          <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">{"\u2014"}</span>
        )}
      </div>

      <div className="flex items-center">
        <span className="truncate text-sm text-foreground/80">{u.location || "\u2014"}</span>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {u.gravity != null && <span>G {formatCompact(u.gravity)}</span>}
        {u.love != null && <span>L {formatCompact(u.love)}</span>}
        {u.reach != null && <span>R {formatCompact(u.reach)}</span>}
      </div>
    </Link>
  )
}

function MembersLoadingState() {
  return (
    <div className="flex items-center justify-center py-20" aria-busy="true">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  )
}

function FiltersPanel({
  filters,
  onFiltersChange,
  onAddSkill,
  onAddTool,
  onClearAll,
  memberCount,
  hasMorePages,
}: {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
  onAddSkill: (skill: string) => void
  onAddTool: (tool: string) => void
  onClearAll: () => void
  memberCount: number
  hasMorePages: boolean
}) {
  const [skillQuery, setSkillQuery] = React.useState("")
  const [toolQuery, setToolQuery] = React.useState("")

  const countryItems = React.useMemo(() => COUNTRIES.map((c) => c.name), [])
  const roleItems = React.useMemo<Array<MemberRole | "">>(
    () => ["", "OWNER", "ADMIN", "MOD", "MEMBER"],
    []
  )

  const selectedSkillSet = React.useMemo(() => new Set(filters.skills.map((s) => s.toLowerCase())), [filters.skills])
  const selectedToolSet = React.useMemo(() => new Set(filters.tools.map((t) => t.toLowerCase())), [filters.tools])

  const availableSkills = React.useMemo(() => {
    return (SKILLS as string[]).filter((s) => !selectedSkillSet.has(s.toLowerCase()))
  }, [selectedSkillSet])

  const [toolOptions, setToolOptions] = React.useState<string[]>(TOOLS as string[])
  const availableTools = React.useMemo(() => {
    return toolOptions.filter((t) => !selectedToolSet.has(t.toLowerCase()))
  }, [toolOptions, selectedToolSet])

  function handleAddTool(next: string) {
    const v = next.trim()
    if (!v || selectedToolSet.has(v.toLowerCase())) return
    if (!toolOptions.some((t) => t.toLowerCase() === v.toLowerCase())) {
      setToolOptions((prev) => [v, ...prev])
    }
    onAddTool(v)
    setToolQuery("")
  }

  function handleAddSkill(next: string) {
    const v = next.trim()
    if (!v || selectedSkillSet.has(v.toLowerCase())) return
    onAddSkill(v)
    setSkillQuery("")
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card/30 p-4" aria-label="Member filters">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name, handle, headline\u2026"
            value={filters.q}
            onChange={(e) => onFiltersChange({ q: e.target.value })}
            aria-label="Search members"
          />
        </div>

        <FilterCombobox
          label="Role"
          placeholder="Any"
          items={roleItems}
          value={filters.role || null}
          onValueChange={(v) => onFiltersChange({ role: (v as MemberRole) || "" })}
          renderItem={(item) => item || "Any"}
        />

        <FilterCombobox
          label="Country"
          placeholder="Any"
          items={countryItems}
          value={filters.country || null}
          onValueChange={(v) => onFiltersChange({ country: v || "" })}
        />

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Headline contains</div>
          <Input
            placeholder="e.g. Designer"
            value={filters.headline}
            onChange={(e) => onFiltersChange({ headline: e.target.value })}
            aria-label="Filter by headline"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Bio contains</div>
          <Input
            placeholder="keywords"
            value={filters.bio}
            onChange={(e) => onFiltersChange({ bio: e.target.value })}
            aria-label="Filter by bio"
          />
        </div>

        <div className="grid gap-4 lg:col-span-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-foreground/70">Skills</div>
            <FilterCombobox
              label=""
              placeholder="Add a skill\u2026"
              items={availableSkills}
              value={null}
              onValueChange={(v) => v && handleAddSkill(v)}
              inputValue={skillQuery}
              onInputValueChange={setSkillQuery}
            />
            {filters.skills.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {filters.skills.map((s) => (
                  <Chip key={s} onRemove={() => onFiltersChange({ skills: filters.skills.filter((x) => x !== s) })}>
                    {s}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-foreground/70">Tools</div>
            <FilterCombobox
              label=""
              placeholder="Add a tool\u2026"
              items={availableTools}
              value={null}
              onValueChange={(v) => v && handleAddTool(v)}
              inputValue={toolQuery}
              onInputValueChange={setToolQuery}
              emptyMessage={`Press Enter to add "${toolQuery.trim() || "\u2026"}".`}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAddTool(toolQuery)
                }
              }}
            />
            {filters.tools.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {filters.tools.map((t) => (
                  <Chip key={t} onRemove={() => onFiltersChange({ tools: filters.tools.filter((x) => x !== t) })}>
                    {t}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </div>

        {hasActiveFilters(filters) && (
          <>
            <Separator className="lg:col-span-3" />
            <div className="flex items-center justify-center gap-2 lg:col-span-3">
              <Badge variant="secondary">
                {memberCount}{hasMorePages ? "+" : ""} members
              </Badge>
              <Button type="button" variant="destructive" size="sm" onClick={onClearAll}>
                Clear filters
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function MembersGrid({ items, view, isAdmin, communityHandle, onOrbitOverride }: {
  items: CommunityMember[]
  view: "cards" | "list"
  isAdmin?: boolean
  communityHandle?: string
  onOrbitOverride?: (userId: string, newOverride: string | null) => void
}) {
  if (view === "cards") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((m) => (
          <MemberCard
            key={m.membershipId}
            member={m}
            isAdmin={isAdmin}
            communityHandle={communityHandle}
            onOrbitOverride={onOrbitOverride}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/30 overflow-hidden">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium text-foreground/70">
        <div>Member</div>
        <div>Role</div>
        <div>Location</div>
        <div className="text-right">Score</div>
      </div>
      {items.map((m) => (
        <MemberRow key={m.membershipId} member={m} />
      ))}
    </div>
  )
}

function MembersEmptyState({ hasFilters, onClearFilters }: { hasFilters: boolean; onClearFilters: () => void }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
      <p>No members match your filters.</p>
      {hasFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-2 text-primary hover:underline"
        >
          Clear all filters
        </button>
      )}
    </div>
  )
}

// === PAGE ===

export default function CommunityProfilePage() {
  const router = useRouter()
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

  // --- Members data ---
  const [view, setView] = React.useState<"cards" | "list">("cards")
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem("community-filters-open") === "true"
    } catch {
      return false
    }
  })
  const [isAboutOpen, setIsAboutOpen] = React.useState(() => {
    if (typeof window === "undefined") return true
    try {
      const stored = localStorage.getItem("community-about-open")
      return stored === null ? true : stored === "true"
    } catch {
      return true
    }
  })

  React.useEffect(() => {
    try {
      localStorage.setItem("community-filters-open", String(isFiltersOpen))
    } catch {
      // Storage full or disabled
    }
  }, [isFiltersOpen])

  React.useEffect(() => {
    try {
      localStorage.setItem("community-about-open", String(isAboutOpen))
    } catch {
      // Storage full or disabled
    }
  }, [isAboutOpen])
  const [refreshing, setRefreshing] = React.useState(false)
  const refreshStartedRef = React.useRef(false)

  const [filters, setFilters] = React.useState<FilterState>({
    q: "", role: "", country: "", skills: [], tools: [], headline: "", bio: "",
  })

  const canViewDirectory = state.status === "ready" && state.data.canViewDirectory
  const { data: membersData, items: memberItems, loading: membersLoading, loadingMore, error: membersError } =
    useMembersData(canViewDirectory ? handle : "", filters, cursor)

  const activeFilters = hasActiveFilters(filters)

  React.useEffect(() => {
    setCursor(null)
  }, [filters.q, filters.role, filters.country, filters.skills, filters.tools, filters.headline, filters.bio])

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters({ q: "", role: "", country: "", skills: [], tools: [], headline: "", bio: "" })
  }

  function handleAddSkill(skill: string) {
    setFilters((prev) => ({ ...prev, skills: [...prev.skills, skill] }))
  }

  function handleAddTool(tool: string) {
    setFilters((prev) => ({ ...prev, tools: [...prev.tools, tool] }))
  }

  function handleRefresh() {
    setRefreshing(true)
    refreshStartedRef.current = false
    setCursor(null)
  }

  React.useEffect(() => {
    if (!refreshing) return
    if (membersLoading) {
      refreshStartedRef.current = true
    } else if (refreshStartedRef.current) {
      setRefreshing(false)
      refreshStartedRef.current = false
    }
  }, [refreshing, membersLoading])

  // --- Orbit override optimistic state ---
  const [orbitOverrides, setOrbitOverrides] = React.useState<Map<string, string | null>>(new Map())

  const handleOrbitOverride = React.useCallback((userId: string, newOverride: string | null) => {
    setOrbitOverrides((prev) => {
      const next = new Map(prev)
      next.set(userId, newOverride)
      return next
    })
  }, [])

  // Apply optimistic overrides on top of server data
  const displayItems = React.useMemo(() => {
    if (orbitOverrides.size === 0) return memberItems
    return memberItems.map((m) => {
      const override = orbitOverrides.get(m.user.id)
      if (override === undefined) return m
      return { ...m, user: { ...m.user, orbitLevelOverride: override } }
    })
  }, [memberItems, orbitOverrides])

  // --- SKELETON ---

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-7 pb-40">
        <div className="w-full flex flex-wrap gap-3 p-5">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex gap-3 ml-auto sm:align-center sm:justify-end">
            <Skeleton className="h-9 w-20" />
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
          <CardContent className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-4">
            <CardTitle>
              <Skeleton className="h-5 w-32" />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
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
          <div className="flex items-center gap-2">
            {viewerMembership?.status !== "APPROVED" && community.isMembershipOpen ? (
              <Button variant="secondary" render={<Link href={communityApplyPath(handleLabel)} />}>
                Apply
              </Button>
            ) : null}
            {canViewDirectory ? (
              <>
                <Button type="button" variant="secondary" disabled={refreshing} onClick={handleRefresh}>
                  {refreshing && <RefreshCw className="size-4 animate-spin" />}
                  {refreshing ? "Refreshing\u2026" : "Refresh"}
                </Button>
                <Button type="button" variant={isFiltersOpen ? "default" : "secondary"} onClick={() => setIsFiltersOpen((v) => !v)}>
                  Filters
                </Button>
                <Tabs className="gap-0" value={view} onValueChange={(v) => setView(v === "list" ? "list" : "cards")}>
                  <TabsList>
                    <TabsTrigger value="cards" aria-label="Cards view" className="cursor-pointer px-3 !border-transparent data-active:!bg-primary data-active:!text-primary-foreground">
                      <LayoutGrid className="size-4" />
                    </TabsTrigger>
                    <TabsTrigger value="list" aria-label="List view" className="cursor-pointer px-3 !border-transparent data-active:!bg-primary data-active:!text-primary-foreground">
                      <List className="size-4" />
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="cards" />
                  <TabsContent value="list" />
                </Tabs>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setIsAboutOpen((v) => !v)}
              aria-label={isAboutOpen ? "Hide community info" : "Show community info"}
              aria-expanded={isAboutOpen}
              className={`inline-flex h-9 items-center justify-center rounded-4xl px-4 text-sm font-medium transition-colors cursor-pointer ${
                isAboutOpen
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              About
            </button>
            <PageHeaderMenu
              items={[
                { label: "Orbit", href: communityOrbitPath(handleLabel) },
                ...(isAdmin
                  ? [{ label: "Applications", href: communityApplicationsPath(handleLabel) }]
                  : []),
                ...(isAdmin
                  ? [{ label: "Settings", href: communitySettingsPath(handleLabel) }]
                  : []),
              ]}
            />
          </div>
        }
        actionsAsFormActions={false}
      />

      {/* Social accounts (toggled via info button in header) */}
      {isAboutOpen && (() => {
        const socials = SOCIAL_LINKS.filter(
          (s) => community[s.key],
        )

        return socials.length > 0 ? (
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
        ) : null
      })()}

      {/* About (toggled via info button in header) */}
      {isAboutOpen && (
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
      )}

      {/* Member directory */}
      {canViewDirectory ? (
        <>

          {isFiltersOpen && (
            <FiltersPanel
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onAddSkill={handleAddSkill}
              onAddTool={handleAddTool}
              onClearAll={handleClearAll}
              memberCount={memberItems.length}
              hasMorePages={!!membersData?.page?.nextCursor}
            />
          )}

          {membersError && (
            <div
              className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
              role="alert"
            >
              {membersError}
            </div>
          )}

          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {membersLoading ? "Loading members..." : `${memberItems.length} members loaded`}
          </div>

          {membersLoading ? (
            <MembersLoadingState />
          ) : memberItems.length === 0 ? (
            <MembersEmptyState hasFilters={activeFilters} onClearFilters={handleClearAll} />
          ) : (
            <InfiniteScroll
              onLoadMore={() => setCursor(membersData?.page?.nextCursor ?? null)}
              hasMore={!!membersData?.page?.nextCursor}
              isLoading={loadingMore}
            >
              <MembersGrid
                items={displayItems}
                view={view}
                isAdmin={isAdmin}
                communityHandle={handleLabel}
                onOrbitOverride={handleOrbitOverride}
              />
            </InfiniteScroll>
          )}
        </>
      ) : null}
    </div>
  )
}

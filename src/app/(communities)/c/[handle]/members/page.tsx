"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LayoutGrid, List, Lock, MoreVertical, Search } from "lucide-react"
import { useSession } from "next-auth/react"

import { cn } from "@/lib/utils"
import { apiGet, apiPost } from "@/lib/api/client"
import {
  communityJoinPath,
  userPath,
  ROUTES,
} from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { LANGUAGE_LIST as LANGUAGES } from "@/config/languages"
import { SKILL_LIST as SKILLS, TOOL_LIST as TOOLS } from "@/lib/attestations/definitions"

import { ListFeed } from "@/components/common/list-feed"
import { ProfileAvatar } from "@/components/common/profile-avatar"
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

import { useCommunity } from "../community-provider"

// === CONSTANTS ===

const PAGE_SIZE = 50
const DEBOUNCE_DELAY = 300

// === TYPES ===

type MemberRole = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER"

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
  updatedAt?: string | null
  bannedByHandle?: string | null
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
  orbitLevel: string
  orbitLevelType: string
  language: string
}

type QueryParams = {
  handle: string
  q?: string
  role?: string
  location?: string
  skills?: string
  tools?: string
  orbitLevel?: string
  orbitLevelType?: string
  languages?: string
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
    updatedAt: string | null
    bannedByHandle: string | null
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
    updatedAt: item.membership.updatedAt,
    bannedByHandle: item.membership.bannedByHandle,
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
    orbitLevel: optionalString(filters.orbitLevel),
    orbitLevelType: optionalString(filters.orbitLevelType),
    languages: optionalString(filters.language),
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
    filters.orbitLevel ||
    filters.orbitLevelType ||
    filters.language
  )
}

function formatOrbitLevel(level: string | null | undefined): string | null {
  if (!level) return null
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase()
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

  const queryObject = React.useMemo(() => {
    return buildQueryParams(
      communityHandle,
      { ...filters, q: debouncedQ },
      cursor
    )
  }, [
    communityHandle, debouncedQ, filters.role, filters.country,
    filters.skills, filters.tools, filters.orbitLevel, filters.orbitLevelType,
    filters.language, cursor,
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

// === CONSTANTS (UI) ===

const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MODERATOR: "Mod",
  MEMBER: "Member",
}

const ORBIT_LEVELS = [
  { value: "EXPLORER", label: "Explorer" },
  { value: "PARTICIPANT", label: "Participant" },
  { value: "CONTRIBUTOR", label: "Contributor" },
  { value: "ADVOCATE", label: "Advocate" },
] as const

const ASSIGNABLE_ROLES = [
  { value: "MEMBER", label: "Member" },
  { value: "MODERATOR", label: "Moderator" },
  { value: "ADMIN", label: "Admin" },
] as const

// === SUB-COMPONENTS ===

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
                  className="data-[highlighted]:bg-accent/10 data-[highlighted]:text-primary flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
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

function AdminMemberMenu({
  member,
  communityHandle,
  isOwner,
  onOrbitOverride,
  onRoleChange,
  onBanSuccess,
}: {
  member: CommunityMember
  communityHandle: string
  isOwner: boolean
  onOrbitOverride: (userId: string, newOverride: string | null) => void
  onRoleChange?: (userId: string, newRole: MemberRole) => void
  onBanSuccess?: (membershipId: string) => void
}) {
  const [banDialogOpen, setBanDialogOpen] = React.useState(false)
  const [banning, setBanning] = React.useState(false)

  const u = member.user
  const currentOrbit = u.orbitLevelOverride ?? "auto"
  const currentRole = member.role
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

  function handleRoleChange(nextValue: unknown) {
    const next = String(nextValue) as MemberRole
    if (next === currentRole) return
    onRoleChange?.(u.id, next)

    void apiPost("/api/membership/role", {
      communityHandle,
      userId: u.id,
      role: next,
    })
  }

  async function handleBan() {
    setBanning(true)

    const result = await apiPost("/api/membership/status", {
      membershipId: member.membershipId,
      status: "BANNED",
    })

    setBanning(false)
    setBanDialogOpen(false)

    if (result.ok) {
      onBanSuccess?.(member.membershipId)
    }
  }

  return (
    <>
      <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <Menu>
          <MenuTrigger
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-primary hover:bg-accent/10 cursor-pointer"
            aria-label="Member actions"
          >
            <MoreVertical className="size-3.5" />
          </MenuTrigger>
          <MenuContent align="end" sideOffset={4}>
            <MenuGroup>
              <MenuLabel>Orbit level</MenuLabel>
              <MenuRadioGroup value={currentOrbit} onValueChange={handleOrbitChange}>
                <MenuRadioItem value="auto">Auto</MenuRadioItem>
                {ORBIT_LEVELS.map((l) => (
                  <MenuRadioItem key={l.value} value={l.value}>{l.label}</MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            {isOwner && (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuLabel>Role</MenuLabel>
                  <MenuRadioGroup value={currentRole} onValueChange={handleRoleChange}>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <MenuRadioItem key={r.value} value={r.value}>{r.label}</MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </>
            )}
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

function MemberCard({ member, isAdmin, isOwner: viewerIsOwner, viewerUserId, communityHandle, onOrbitOverride, onRoleChange, onBanSuccess }: {
  member: CommunityMember
  isAdmin?: boolean
  isOwner?: boolean
  viewerUserId?: string | null
  communityHandle?: string
  onOrbitOverride?: (userId: string, newOverride: string | null) => void
  onRoleChange?: (userId: string, newRole: MemberRole) => void
  onBanSuccess?: (membershipId: string) => void
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
  const isSelf = !!viewerUserId && viewerUserId === u.id
  const isMemberOwner = member.role === "OWNER"
  const showAdminMenu = isAdmin && communityHandle && onOrbitOverride && !isSelf && !isMemberOwner

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
                    <Badge variant="destructive" className="gap-2">
                      <Lock className="size-2.5" />
                      {orbitLabel}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {member.role === "OWNER" ? "Owner — always Advocate" : "Manually set by admin"}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Badge variant="secondary">{orbitLabel}</Badge>
              )
            )}
            {member.role !== "MEMBER" && (
              <Badge variant="info">{ROLE_LABELS[member.role]}</Badge>
            )}
            {showAdminMenu && (
              <AdminMemberMenu
                member={member}
                communityHandle={communityHandle}
                isOwner={!!viewerIsOwner}
                onOrbitOverride={onOrbitOverride}
                onRoleChange={onRoleChange}
                onBanSuccess={onBanSuccess}
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

function MemberRow({ member, isAdmin, isOwner: viewerIsOwner, viewerUserId, communityHandle, onOrbitOverride, onRoleChange, onBanSuccess }: {
  member: CommunityMember
  isAdmin?: boolean
  isOwner?: boolean
  viewerUserId?: string | null
  communityHandle?: string
  onOrbitOverride?: (userId: string, newOverride: string | null) => void
  onRoleChange?: (userId: string, newRole: MemberRole) => void
  onBanSuccess?: (membershipId: string) => void
}) {
  const u = member.user
  const displayName = u.name?.trim() || `@${u.handle}`
  const href = userPath(u.handle)
  const hasScores = u.gravity != null || u.love != null || u.reach != null

  const isOrbitOverridden = u.orbitLevelOverride != null
  const effectiveOrbit = u.orbitLevelOverride ?? u.orbitLevel
  const orbitLabel = formatOrbitLevel(effectiveOrbit)
  const isSelf = !!viewerUserId && viewerUserId === u.id
  const isMemberOwner = member.role === "OWNER"
  const showAdminMenu = isAdmin && communityHandle && onOrbitOverride && !isSelf && !isMemberOwner

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:bg-card/50">
      <Link href={href} className="flex min-w-0 items-center gap-2 hover:opacity-80 transition-opacity">
        <ProfileAvatar type="user" src={u.image} name={displayName} size="sm" />
        <span className="truncate text-sm font-medium">{displayName}</span>
        <span className="truncate text-xs text-muted-foreground">@{u.handle}</span>
      </Link>

      <div className="flex items-center gap-2 shrink-0">
        {orbitLabel && (
          isOrbitOverridden ? (
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="destructive" className="gap-2">
                  <Lock className="size-2.5" />
                  {orbitLabel}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {member.role === "OWNER" ? "Owner — always Advocate" : "Manually set by admin"}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Badge variant="secondary">{orbitLabel}</Badge>
          )
        )}
        {member.role !== "MEMBER" && (
          <Badge variant="info">{ROLE_LABELS[member.role]}</Badge>
        )}
        {hasScores && (
          <div className="hidden sm:inline-flex items-center divide-x divide-border/60 rounded-full border border-border/60 text-xs">
            <div className="flex items-center gap-1 px-2 py-0.5">
              <span className="text-[10px] text-muted-foreground">L</span>
              <span className="font-medium">{u.love != null ? formatCompact(u.love) : "\u2014"}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5">
              <span className="text-[10px] text-muted-foreground">R</span>
              <span className="font-medium">{u.reach != null ? formatCompact(u.reach) : "\u2014"}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5">
              <span className="text-[10px] text-muted-foreground">G</span>
              <span className="font-medium">{u.gravity != null ? formatCompact(u.gravity) : "\u2014"}</span>
            </div>
          </div>
        )}
        {showAdminMenu && (
          <AdminMemberMenu
            member={member}
            communityHandle={communityHandle}
            isOwner={!!viewerIsOwner}
            onOrbitOverride={onOrbitOverride}
            onRoleChange={onRoleChange}
            onBanSuccess={onBanSuccess}
          />
        )}
      </div>
    </div>
  )
}

function MemberCardSkeleton() {
  return (
    <Card size="sm">
      <CardHeader className="!gap-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <Skeleton className="size-10 rounded-full shrink-0" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 divide-x divide-border/60 rounded-lg border border-border/60 py-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <Skeleton className="h-2.5 w-8" />
              <Skeleton className="h-3 w-6" />
            </div>
          ))}
        </div>
      </CardContent>
      <CardContent>
        <Skeleton className="h-2.5 w-10 mb-2" />
        <div className="flex gap-1">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-18 rounded-full" />
        </div>
      </CardContent>
    </Card>
  )
}

function MembersLoadingState() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <MemberCardSkeleton key={i} />
      ))}
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
    () => ["", "OWNER", "ADMIN", "MODERATOR", "MEMBER"],
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

  const orbitLevelItems = React.useMemo(() => ["", ...ORBIT_LEVELS.map((l) => l.value)], [])
  const orbitTypeItems = React.useMemo(() => ["", "auto", "manual"], [])
  const languageItems = React.useMemo(() => LANGUAGES as string[], [])

  return (
    <section className="rounded-2xl border border-border/60 bg-card/30 p-4" aria-label="Member filters">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Row 1: Search + Role */}
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name, handle, bio..."
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
          renderItem={(item) => (item ? item.charAt(0) + item.slice(1).toLowerCase() : "Any")}
        />

        {/* Row 2: Country + Language */}
        <FilterCombobox
          label="Country"
          placeholder="Any"
          items={countryItems}
          value={filters.country || null}
          onValueChange={(v) => onFiltersChange({ country: v || "" })}
        />

        <FilterCombobox
          label="Language"
          placeholder="Any"
          items={languageItems}
          value={filters.language || null}
          onValueChange={(v) => onFiltersChange({ language: v || "" })}
        />

        {/* Row 3: Orbit level + Orbit level type */}
        <FilterCombobox
          label="Orbit level"
          placeholder="Any"
          items={orbitLevelItems}
          value={filters.orbitLevel || null}
          onValueChange={(v) => onFiltersChange({ orbitLevel: v || "" })}
          renderItem={(item) => (item ? item.charAt(0) + item.slice(1).toLowerCase() : "Any")}
        />

        <FilterCombobox
          label="Orbit level type"
          placeholder="Any"
          items={orbitTypeItems}
          value={filters.orbitLevelType || null}
          onValueChange={(v) => onFiltersChange({ orbitLevelType: v || "" })}
          renderItem={(item) => (item === "auto" ? "Auto" : item === "manual" ? "Manual" : "Any")}
        />

        {/* Row 4: Skills + Tools */}
        <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-foreground/70">Skills</div>
            <FilterCombobox
              label=""
              placeholder="Any"
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
              placeholder="Any"
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
            <Separator className="lg:col-span-2" />
            <div className="flex items-center justify-center gap-2 lg:col-span-2">
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

function MembersGrid({ items, view, isAdmin, isOwner, viewerUserId, communityHandle, onOrbitOverride, onRoleChange, onBanSuccess }: {
  items: CommunityMember[]
  view: "cards" | "list"
  isAdmin?: boolean
  isOwner?: boolean
  viewerUserId?: string | null
  communityHandle?: string
  onOrbitOverride?: (userId: string, newOverride: string | null) => void
  onRoleChange?: (userId: string, newRole: MemberRole) => void
  onBanSuccess?: (membershipId: string) => void
}) {
  if (view === "cards") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((m) => (
          <MemberCard
            key={m.membershipId}
            member={m}
            isAdmin={isAdmin}
            isOwner={isOwner}
            viewerUserId={viewerUserId}
            communityHandle={communityHandle}
            onOrbitOverride={onOrbitOverride}
            onRoleChange={onRoleChange}
            onBanSuccess={onBanSuccess}
          />
        ))}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>Community members directory.</CardDescription>
      </CardHeader>
      <CardContent>
        <ListFeed<CommunityMember>
          items={items}
          keyExtractor={(m) => m.membershipId}
          renderItem={(m) => (
            <MemberRow
              member={m}
              isAdmin={isAdmin}
              isOwner={isOwner}
              viewerUserId={viewerUserId}
              communityHandle={communityHandle}
              onOrbitOverride={onOrbitOverride}
              onRoleChange={onRoleChange}
              onBanSuccess={onBanSuccess}
            />
          )}
          loading={false}
          emptyMessage="No members match your filters."
        />
      </CardContent>
    </Card>
  )
}

function MembersEmptyState({ hasFilters, onClearFilters }: { hasFilters: boolean; onClearFilters: () => void }) {
  return (
    <Card>
      <CardContent>
        <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
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
      </CardContent>
    </Card>
  )
}

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
            "mx-auto flex w-full max-w-4xl items-center justify-center",
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

// === PAGE ===

export default function CommunityMembersPage() {
  const { data: session } = useSession()
  const viewerUserId = session?.user?.id ?? null
  const ctx = useCommunity()
  const handle = ctx.handle

  // --- Members data ---
  const [view, setView] = React.useState<"cards" | "list">(() => {
    if (typeof window === "undefined") return "cards"
    try {
      const stored = localStorage.getItem("community-view")
      if (stored === "cards" || stored === "list") return stored
    } catch {
      // Ignore
    }
    return "cards"
  })
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem("community-filters-open") === "true"
    } catch {
      return false
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
      localStorage.setItem("community-view", view)
    } catch {
      // Storage full or disabled
    }
  }, [view])

  const [filters, setFilters] = React.useState<FilterState>({
    q: "", role: "", country: "", skills: [], tools: [], orbitLevel: "", orbitLevelType: "", language: "",
  })

  const canViewDirectory = ctx.status === "ready" && ctx.canViewDirectory
  const { data: membersData, items: memberItems, loading: membersLoading, loadingMore, error: membersError } =
    useMembersData(canViewDirectory ? handle : "", filters, cursor)

  const activeFilters = hasActiveFilters(filters)

  React.useEffect(() => {
    setCursor(null)
  }, [filters.q, filters.role, filters.country, filters.skills, filters.tools, filters.orbitLevel, filters.orbitLevelType, filters.language])

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters({ q: "", role: "", country: "", skills: [], tools: [], orbitLevel: "", orbitLevelType: "", language: "" })
  }

  function handleAddSkill(skill: string) {
    setFilters((prev) => ({ ...prev, skills: [...prev.skills, skill] }))
  }

  function handleAddTool(tool: string) {
    setFilters((prev) => ({ ...prev, tools: [...prev.tools, tool] }))
  }

  // --- Orbit override optimistic state ---
  const [orbitOverrides, setOrbitOverrides] = React.useState<Map<string, string | null>>(new Map())

  const handleOrbitOverride = React.useCallback((userId: string, newOverride: string | null) => {
    setOrbitOverrides((prev) => {
      const next = new Map(prev)
      next.set(userId, newOverride)
      return next
    })
  }, [])

  // --- Role override optimistic state ---
  const [roleOverrides, setRoleOverrides] = React.useState<Map<string, MemberRole>>(new Map())

  const handleRoleChange = React.useCallback((userId: string, newRole: MemberRole) => {
    setRoleOverrides((prev) => {
      const next = new Map(prev)
      next.set(userId, newRole)
      return next
    })
  }, [])

  // --- Banned member optimistic state ---
  const [bannedMemberIds, setBannedMemberIds] = React.useState<Set<string>>(new Set())

  const handleBanSuccess = React.useCallback((membershipId: string) => {
    setBannedMemberIds((prev) => {
      const next = new Set(prev)
      next.add(membershipId)
      return next
    })
  }, [])

  // --- Apply optimistic overrides on top of server data ---
  const displayItems = React.useMemo(() => {
    let items = memberItems

    // Filter out optimistically banned members
    if (bannedMemberIds.size > 0) {
      items = items.filter((m) => !bannedMemberIds.has(m.membershipId))
    }

    // Apply orbit level + role overrides
    if (orbitOverrides.size === 0 && roleOverrides.size === 0) return items
    return items.map((m) => {
      const orbitOverride = orbitOverrides.get(m.user.id)
      const roleOverride = roleOverrides.get(m.user.id)
      if (orbitOverride === undefined && roleOverride === undefined) return m
      return {
        ...m,
        ...(roleOverride !== undefined ? { role: roleOverride } : {}),
        user: {
          ...m.user,
          ...(orbitOverride !== undefined ? { orbitLevelOverride: orbitOverride } : {}),
        },
      }
    })
  }, [memberItems, orbitOverrides, roleOverrides, bannedMemberIds])

  // Inject toolbar slot — Filters + ViewSwitch
  React.useEffect(() => {
    if (!canViewDirectory) {
      ctx.setToolbarSlot(null)
      return
    }
    ctx.setToolbarSlot({
      actions: [
        { label: "Filters", icon: Search, active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) },
      ],
      viewSwitch: {
        value: view,
        onChange: (v) => setView(v as "cards" | "list"),
        options: [
          { value: "cards", icon: LayoutGrid, label: "Cards" },
          { value: "list", icon: List, label: "List" },
        ],
      },
    })
    return () => ctx.setToolbarSlot(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewDirectory, isFiltersOpen, view])

  // --- LOADING / READY ---

  const isPageLoading = ctx.status === "loading"
  const community = ctx.community
  const isAdmin = ctx.isAdmin
  const viewerMembership = ctx.viewerMembership

  const handleLabel = community?.handle ?? handle

  if (isPageLoading) {
    return <MembersLoadingState />
  }

  return (
    <>
      {/* Join banner for non-members when membership is open */}
      {viewerMembership?.status !== "APPROVED" && community?.isMembershipOpen ? (
        <JoinBanner name={community.name} handle={handleLabel} pending={viewerMembership?.status === "PENDING"} />
      ) : null}

      {/* Member directory */}
      {canViewDirectory ? (
        <>
          {isFiltersOpen && (
            <>
            <Separator />
            <FiltersPanel
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onAddSkill={handleAddSkill}
              onAddTool={handleAddTool}
              onClearAll={handleClearAll}
              memberCount={memberItems.length}
              hasMorePages={!!membersData?.page?.nextCursor}
            />
            </>
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
                isOwner={viewerMembership?.role === "OWNER"}
                viewerUserId={viewerUserId}
                communityHandle={handleLabel}
                onOrbitOverride={handleOrbitOverride}
                onRoleChange={handleRoleChange}
                onBanSuccess={handleBanSuccess}
              />
            </InfiniteScroll>
          )}
        </>
      ) : (
        <Card>
          <CardContent>
            <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              Member directory is not publicly visible. Join the community to view members.
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}

"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { apiGet } from "@/lib/api-client"
import { ROUTES, userPath } from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { SKILLS } from "@/config/skills"
import { TOOLS } from "@/config/tools"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Constants
const PAGE_SIZE = 50
const DEBOUNCE_DELAY = 300
const LOADING_SKELETON_COUNT = 9

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
  orbitLevel?: string | null
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
  community: {
    id: string
    handle: string
    name: string
    avatarUrl?: string | null
  }
  page: {
    nextCursor: string | null
  }
  members: CommunityMember[]
  facets?: {
    roles?: { value: MemberRole; count: number }[]
    countries?: { value: string; count: number }[]
    skills?: { value: string; count: number }[]
    tools?: { value: string; count: number }[]
  }
}

type QueryParams = {
  handle: string
  q?: string
  role?: string
  country?: string
  skills?: string
  tools?: string
  headline?: string
  bio?: string
  linkDomain?: string
  loveMin?: number
  loveMax?: number
  reachMin?: number
  reachMax?: number
  gravityMin?: number
  gravityMax?: number
  cursor?: string
  limit: number
}

function normalizeMembersPayload(raw: unknown, fallbackHandle: string): MembersResponse {
  const r = raw as Record<string, unknown> | null

  const communityRaw = (r && (r["community"] as Record<string, unknown> | null)) || null
  const community: MembersResponse["community"] = {
    id: String((communityRaw && communityRaw["id"]) || ""),
    handle: String((communityRaw && communityRaw["handle"]) || fallbackHandle),
    name: String((communityRaw && communityRaw["name"]) || "Community"),
    avatarUrl: (communityRaw && (communityRaw["avatarUrl"] as string | null | undefined)) || null,
  }

  // Support a few historical payload shapes.
  const pageRaw = (r && (r["page"] as Record<string, unknown> | null)) || null
  const nextCursorFromPage = pageRaw ? (pageRaw["nextCursor"] as string | null | undefined) : null
  const nextCursor =
    (typeof nextCursorFromPage === "string" ? nextCursorFromPage : null) ||
    (typeof (r && r["nextCursor"]) === "string" ? (r!["nextCursor"] as string) : null) ||
    null

  const membersRaw =
    (r && (r["members"] as unknown)) ??
    (r && (r["items"] as unknown)) ??
    (r && (r["memberships"] as unknown))

  const members: CommunityMember[] = Array.isArray(membersRaw) ? (membersRaw as CommunityMember[]) : []

  const facets = (r && (r["facets"] as MembersResponse["facets"])) || undefined

  return {
    community,
    page: { nextCursor },
    members,
    facets,
  }
}

// Utility functions
function mergeMembersUnique(prev: CommunityMember[], next: CommunityMember[]) {
  const out: CommunityMember[] = []
  const seen = new Set<string>()

  for (const m of prev) {
    if (!m) continue
    if (seen.has(m.membershipId)) continue
    seen.add(m.membershipId)
    out.push(m)
  }

  for (const m of next) {
    if (!m) continue
    if (seen.has(m.membershipId)) continue
    seen.add(m.membershipId)
    out.push(m)
  }

  return out
}

function uniqStrings(values: string[]) {
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

function clampInt(v: string, min: number, max: number): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  if (i < min || i > max) return null
  return i
}

function opt(value: string | undefined | null): string | undefined {
  const v = (value ?? "").trim()
  return v || undefined
}

function asCsv(values: string[]) {
  const v = uniqStrings(values)
  return v.length ? v.join(",") : undefined
}

function formatCompact(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return ""
  return Intl.NumberFormat(undefined, { notation: "compact" }).format(n)
}

function initials(nameOrHandle: string) {
  const s = nameOrHandle.trim()
  if (!s) return "?"
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase()
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = React.useState(value)

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])

  return debounced
}

function buildQueryParams(
  handle: string,
  filters: {
    q: string
    role: string
    country: string
    skills: string[]
    tools: string[]
    headline: string
    bio: string
    linkDomain: string
    loveMin: string
    loveMax: string
    reachMin: string
    reachMax: string
    gravityMin: string
    gravityMax: string
  },
  cursor: string | null
): QueryParams {
  const loveMinN = filters.loveMin.trim() ? clampInt(filters.loveMin, 0, 1_000_000) : null
  const loveMaxN = filters.loveMax.trim() ? clampInt(filters.loveMax, 0, 1_000_000) : null
  const reachMinN = filters.reachMin.trim() ? clampInt(filters.reachMin, 0, 1_000_000) : null
  const reachMaxN = filters.reachMax.trim() ? clampInt(filters.reachMax, 0, 1_000_000) : null
  const gravityMinN = filters.gravityMin.trim() ? clampInt(filters.gravityMin, 0, 1_000_000_000) : null
  const gravityMaxN = filters.gravityMax.trim() ? clampInt(filters.gravityMax, 0, 1_000_000_000) : null

  return {
    handle,
    q: opt(filters.q),
    role: opt(filters.role),
    country: opt(filters.country),
    skills: asCsv(filters.skills),
    tools: asCsv(filters.tools),
    headline: opt(filters.headline),
    bio: opt(filters.bio),
    linkDomain: opt(filters.linkDomain),
    loveMin: loveMinN ?? undefined,
    loveMax: loveMaxN ?? undefined,
    reachMin: reachMinN ?? undefined,
    reachMax: reachMaxN ?? undefined,
    gravityMin: gravityMinN ?? undefined,
    gravityMax: gravityMaxN ?? undefined,
    cursor: cursor ?? undefined,
    limit: PAGE_SIZE,
  }
}

// Components
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
      <div className="text-xs font-medium text-foreground/70">{label}</div>
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

type MemberCardProps = {
  member: CommunityMember
}

function MemberCard({ member }: MemberCardProps) {
  const u = member.user
  const displayName = u.name?.trim() || `@${u.handle}`
  const href = userPath(u.handle)

  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border/60 bg-card/30 p-4 transition-colors hover:bg-card/50"
      aria-label={`View ${displayName}'s profile`}
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={u.image ?? undefined} alt={displayName} />
          <AvatarFallback>{initials(displayName)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">@{u.handle}</div>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {member.role}
            </Badge>
          </div>

          {u.headline && <div className="text-xs text-foreground/80 line-clamp-2">{u.headline}</div>}

          <div className="mt-2 flex flex-wrap gap-2">
            {u.location && <Chip>{u.location}</Chip>}
            {u.love != null && <Chip>Love {formatCompact(u.love)}</Chip>}
            {u.reach != null && <Chip>Reach {formatCompact(u.reach)}</Chip>}
            {u.gravity != null && <Chip>Gravity {formatCompact(u.gravity)}</Chip>}
          </div>

          {(u.skills?.length || u.tools?.length) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {(u.skills || []).slice(0, 4).map((s) => (
                <span
                  key={`s:${s}`}
                  className="inline-flex items-center rounded-4xl bg-muted-foreground/10 px-2 py-1 text-[11px] text-foreground/90"
                >
                  {s}
                </span>
              ))}
              {(u.tools || []).slice(0, 4).map((t) => (
                <span
                  key={`t:${t}`}
                  className="inline-flex items-center rounded-4xl bg-muted-foreground/10 px-2 py-1 text-[11px] text-foreground/90"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-4 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        View profile
      </div>
    </Link>
  )
}

type MemberRowProps = {
  member: CommunityMember
}

function MemberRow({ member }: MemberRowProps) {
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
        <Avatar className="h-8 w-8">
          <AvatarImage src={u.image ?? undefined} alt={displayName} />
          <AvatarFallback>{initials(displayName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate font-medium">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">@{u.handle}</div>
          {u.headline && <div className="truncate text-xs text-foreground/70">{u.headline}</div>}
        </div>
      </div>

      <div className="flex items-center">
        <Badge variant="secondary">{member.role}</Badge>
      </div>

      <div className="flex items-center">
        <span className="truncate text-sm text-foreground/80">{u.location || "—"}</span>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {u.gravity != null && <span>G {formatCompact(u.gravity)}</span>}
        {u.love != null && <span>L {formatCompact(u.love)}</span>}
        {u.reach != null && <span>R {formatCompact(u.reach)}</span>}
      </div>
    </Link>
  )
}

export default function CommunityMembersPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const handle = params.handle?.trim() || ""

  // View + paging
  const [view, setView] = React.useState<"cards" | "list">("cards")
  const [cursor, setCursor] = React.useState<string | null>(null)

  // Filters
  const [q, setQ] = React.useState("")
  const [role, setRole] = React.useState<MemberRole | "">("")
  const [country, setCountry] = React.useState("")
  const [skills, setSkills] = React.useState<string[]>([])
  const [tools, setTools] = React.useState<string[]>([])
  const [headline, setHeadline] = React.useState("")
  const [bio, setBio] = React.useState("")
  const [linkDomain, setLinkDomain] = React.useState("")
  const [loveMin, setLoveMin] = React.useState("")
  const [loveMax, setLoveMax] = React.useState("")
  const [reachMin, setReachMin] = React.useState("")
  const [reachMax, setReachMax] = React.useState("")
  const [gravityMin, setGravityMin] = React.useState("")
  const [gravityMax, setGravityMax] = React.useState("")

  // UI state
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [data, setData] = React.useState<MembersResponse | null>(null)
  const [items, setItems] = React.useState<CommunityMember[]>([])

  const memberCount = items.length

  const debouncedQ = useDebouncedValue(q, DEBOUNCE_DELAY)
  const debouncedHeadline = useDebouncedValue(headline, DEBOUNCE_DELAY)
  const debouncedBio = useDebouncedValue(bio, DEBOUNCE_DELAY)
  const debouncedLinkDomain = useDebouncedValue(linkDomain, DEBOUNCE_DELAY)

  const countryItems = React.useMemo(() => COUNTRIES.map((c) => c.name), [])
  const roleItems = React.useMemo<Array<MemberRole | "">>(
    () => ["", "OWNER", "ADMIN", "MOD", "MEMBER"],
    []
  )

  const selectedSkillSet = React.useMemo(() => new Set(skills.map((s) => s.toLowerCase())), [skills])
  const selectedToolSet = React.useMemo(() => new Set(tools.map((t) => t.toLowerCase())), [tools])

  const availableSkills = React.useMemo(() => {
    return (SKILLS as string[]).filter((s) => !selectedSkillSet.has(s.toLowerCase()))
  }, [selectedSkillSet])

  const [toolOptions, setToolOptions] = React.useState<string[]>(TOOLS as string[])
  const availableTools = React.useMemo(() => {
    return toolOptions.filter((t) => !selectedToolSet.has(t.toLowerCase()))
  }, [toolOptions, selectedToolSet])

  const [skillQuery, setSkillQuery] = React.useState("")
  const [toolQuery, setToolQuery] = React.useState("")

  const hasActiveFilters = Boolean(
    q || role || country || skills.length || tools.length || headline || bio ||
    linkDomain || loveMin || loveMax || reachMin || reachMax || gravityMin || gravityMax
  )

  const queryObject = React.useMemo(() => {
    return buildQueryParams(
      handle,
      {
        q: debouncedQ,
        role,
        country,
        skills,
        tools,
        headline: debouncedHeadline,
        bio: debouncedBio,
        linkDomain: debouncedLinkDomain,
        loveMin,
        loveMax,
        reachMin,
        reachMax,
        gravityMin,
        gravityMax,
      },
      cursor
    )
  }, [
    handle,
    debouncedQ,
    role,
    country,
    skills,
    tools,
    debouncedHeadline,
    debouncedBio,
    debouncedLinkDomain,
    loveMin,
    loveMax,
    reachMin,
    reachMax,
    gravityMin,
    gravityMax,
    cursor,
  ])

  // Reset paging when filters change (except cursor)
  React.useEffect(() => {
    setCursor(null)
  }, [
    handle,
    debouncedQ,
    role,
    country,
    skills,
    tools,
    debouncedHeadline,
    debouncedBio,
    debouncedLinkDomain,
    loveMin,
    loveMax,
    reachMin,
    reachMax,
    gravityMin,
    gravityMax,
  ])

  React.useEffect(() => {
    const ac = new AbortController()

    async function load() {
      setError(null)
      setLoading(cursor === null)
      setLoadingMore(cursor !== null)

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

      const normalized = normalizeMembersPayload(res.value as unknown, handle)
      const nextMembers = normalized.members

      setData(normalized)

      // Apply paging
      setItems((prevItems) => {
        return cursor ? mergeMembersUnique(prevItems, nextMembers) : nextMembers
      })

      setLoading(false)
      setLoadingMore(false)
    }

    void load()

    return () => {
      ac.abort()
    }
  }, [router, queryObject, cursor])

  function clearAll() {
    setQ("")
    setRole("")
    setCountry("")
    setSkills([])
    setTools([])
    setHeadline("")
    setBio("")
    setLinkDomain("")
    setLoveMin("")
    setLoveMax("")
    setReachMin("")
    setReachMax("")
    setGravityMin("")
    setGravityMax("")
  }

  function addTool(next: string) {
    const v = next.trim()
    if (!v) return

    const key = v.toLowerCase()
    if (selectedToolSet.has(key)) return

    if (!toolOptions.some((t) => t.toLowerCase() === key)) {
      setToolOptions((prev) => [v, ...prev])
    }

    setTools((prev) => [...prev, v])
    setToolQuery("")
  }

  function addSkill(next: string) {
    const v = next.trim()
    if (!v) return

    const key = v.toLowerCase()
    if (selectedSkillSet.has(key)) return

    setSkills((prev) => [...prev, v])
    setSkillQuery("")
  }

  const communityName = data?.community?.name || "Community"
  const communityHandle = data?.community?.handle || handle

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={data?.community?.avatarUrl ?? undefined} alt={communityName} />
              <AvatarFallback>{initials(communityName)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <h1 className="text-2xl font-semibold">Members</h1>
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground/80">{communityName}</span> · /c/{communityHandle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v === "list" ? "list" : "cards")}>
              <TabsList>
                <TabsTrigger value="cards">Cards</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
              <TabsContent value="cards" />
              <TabsContent value="list" />
            </Tabs>

            <Button type="button" variant="secondary" onClick={() => setIsFiltersOpen((v) => !v)}>
              {isFiltersOpen ? "Hide filters" : "Show filters"}
            </Button>

            <Button type="button" variant="ghost" onClick={() => router.refresh()}>
              Refresh
            </Button>

            {hasActiveFilters && (
              <Button type="button" variant="ghost" onClick={clearAll}>
                Reset
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {memberCount}
            {data?.page?.nextCursor ? "+" : ""} members
          </Badge>
          {role && <Chip onRemove={() => setRole("")}>Role: {role}</Chip>}
          {country && <Chip onRemove={() => setCountry("")}>Country: {country}</Chip>}
          {skills.map((s) => (
            <Chip key={s} onRemove={() => setSkills((prev) => prev.filter((x) => x !== s))}>
              Skill: {s}
            </Chip>
          ))}
          {tools.map((t) => (
            <Chip key={t} onRemove={() => setTools((prev) => prev.filter((x) => x !== t))}>
              Tool: {t}
            </Chip>
          ))}
        </div>
      </header>

      {isFiltersOpen && (
        <section className="rounded-2xl border border-border/60 bg-card/30 p-4" aria-label="Member filters">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-foreground/70">Search</div>
              <Input
                placeholder="Name, handle, headline…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search members"
              />
            </div>

            <FilterCombobox
              label="Role"
              placeholder="Any"
              items={roleItems}
              value={role || null}
              onValueChange={(v) => setRole((v as MemberRole) || "")}
              renderItem={(item) => item || "Any"}
            />

            <FilterCombobox
              label="Country"
              placeholder="Any"
              items={countryItems}
              value={country || null}
              onValueChange={(v) => setCountry(v || "")}
            />

            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-foreground/70">Headline contains</div>
              <Input
                placeholder="e.g. Designer"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                aria-label="Filter by headline"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-foreground/70">Bio contains</div>
              <Input
                placeholder="keywords"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                aria-label="Filter by bio"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-foreground/70">Link domain</div>
              <Input
                placeholder="e.g. github.com"
                value={linkDomain}
                onChange={(e) => setLinkDomain(e.target.value)}
                aria-label="Filter by link domain"
              />
            </div>

            <div className="grid gap-4 lg:col-span-3 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-foreground/70">Skills</div>
                <FilterCombobox
                  label=""
                  placeholder="Add a skill…"
                  items={availableSkills}
                  value={null}
                  onValueChange={(v) => v && addSkill(v)}
                  inputValue={skillQuery}
                  onInputValueChange={setSkillQuery}
                />

                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {skills.map((s) => (
                      <Chip key={s} onRemove={() => setSkills((prev) => prev.filter((x) => x !== s))}>
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
                  placeholder="Add a tool…"
                  items={availableTools}
                  value={null}
                  onValueChange={(v) => v && addTool(v)}
                  inputValue={toolQuery}
                  onInputValueChange={setToolQuery}
                  emptyMessage={`Press Enter to add "${toolQuery.trim() || "…"}".`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addTool(toolQuery)
                    }
                  }}
                />

                {tools.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {tools.map((t) => (
                      <Chip key={t} onRemove={() => setTools((prev) => prev.filter((x) => x !== t))}>
                        {t}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 lg:col-span-3 lg:grid-cols-3">
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-foreground/70">Love range</div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Min"
                    value={loveMin}
                    onChange={(e) => setLoveMin(e.target.value)}
                    aria-label="Minimum love score"
                  />
                  <Input
                    placeholder="Max"
                    value={loveMax}
                    onChange={(e) => setLoveMax(e.target.value)}
                    aria-label="Maximum love score"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-foreground/70">Reach range</div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Min"
                    value={reachMin}
                    onChange={(e) => setReachMin(e.target.value)}
                    aria-label="Minimum reach score"
                  />
                  <Input
                    placeholder="Max"
                    value={reachMax}
                    onChange={(e) => setReachMax(e.target.value)}
                    aria-label="Maximum reach score"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-foreground/70">Gravity range</div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Min"
                    value={gravityMin}
                    onChange={(e) => setGravityMin(e.target.value)}
                    aria-label="Minimum gravity score"
                  />
                  <Input
                    placeholder="Max"
                    value={gravityMax}
                    onChange={(e) => setGravityMax(e.target.value)}
                    aria-label="Maximum gravity score"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {error && (
        <div
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loading ? "Loading members..." : `${memberCount} members loaded`}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: LOADING_SKELETON_COUNT }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card/30 p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-muted-foreground/10" />
                <div className="flex-1">
                  <div className="h-4 w-40 rounded bg-muted-foreground/10" />
                  <div className="mt-2 h-3 w-28 rounded bg-muted-foreground/10" />
                </div>
              </div>
              <div className="mt-4 h-3 w-full rounded bg-muted-foreground/10" />
              <div className="mt-2 h-3 w-5/6 rounded bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <MemberCard key={m.membershipId} member={m} />
          ))}
        </div>
      ) : (
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

          {items.length === 0 && !loading && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <p>No members match your filters.</p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-2 text-primary hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && data?.page?.nextCursor && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMore}
            onClick={() => setCursor(data.page.nextCursor)}
            aria-busy={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </main>
  )
}
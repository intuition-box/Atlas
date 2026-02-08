"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { apiGet } from "@/lib/api/client"
import { ROUTES, userPath } from "@/lib/routes"
import { COUNTRIES } from "@/config/countries"
import { SKILL_LIST as SKILLS, TOOL_LIST as TOOLS } from "@/lib/attestations/definitions"

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
import { InfiniteScroll } from "@/components/ui/infinite-scroll"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/common/page-header"
import { UsersIcon } from "@/components/ui/icons"
import { Spinner } from "@/components/ui/spinner"

// === CONSTANTS ===

const PAGE_SIZE = 50
const DEBOUNCE_DELAY = 300

// === TYPES ===

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

type CommunityInfo = {
  id: string
  handle: string
  name: string
  avatarUrl?: string | null
}

type MembersResponse = {
  community: CommunityInfo
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

// === UTILITY FUNCTIONS ===

type ApiMemberItem = {
  membership: {
    id: string
    role: MemberRole
    status: string
    orbitLevel: string | null
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
  }
}

type ApiMembersResponse = {
  items: ApiMemberItem[]
  nextCursor: string | null
}

function normalizeMembersPayload(raw: unknown, fallbackHandle: string): MembersResponse {
  const r = raw as ApiMembersResponse | null

  // The API doesn't return community info, so we create a placeholder
  const community: CommunityInfo = {
    id: "",
    handle: fallbackHandle,
    name: "Community",
    avatarUrl: null,
  }

  const nextCursor = r?.nextCursor ?? null
  const items = r?.items ?? []

  // Transform API response to page's expected format
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
      orbitLevel: item.membership.orbitLevel,
      love: item.membership.loveScore,
      reach: item.membership.reachScore,
      gravity: item.membership.gravityScore,
    },
  }))

  return { community, page: { nextCursor }, members, facets: undefined }
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

// === CUSTOM HOOKS ===

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
      {
        ...filters,
        q: debouncedQ,
        headline: debouncedHeadline,
        bio: debouncedBio,
      },
      cursor
    )
  }, [
    communityHandle,
    debouncedQ,
    filters.role,
    filters.country,
    filters.skills,
    filters.tools,
    debouncedHeadline,
    debouncedBio,
    cursor,
  ])

  React.useEffect(() => {
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
        const nextMembers = normalized.members

        setData(normalized)
        setItems((prevItems) => cursor ? mergeMembersUnique(prevItems, nextMembers) : nextMembers)
        setLoading(false)
        setLoadingMore(false)
      } catch (err) {
        if (!ac.signal.aborted) {
          setError("An unexpected error occurred while loading members.")
          setLoading(false)
          setLoadingMore(false)
        }
      }
    }

    void load()

    return () => {
      ac.abort()
    }
  }, [router, queryObject, cursor, communityHandle])

  return { data, items, loading, loadingMore, error }
}

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

function MemberCard({ member }: { member: CommunityMember }) {
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
          <AvatarFallback><UsersIcon /></AvatarFallback>
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
        <Avatar className="h-8 w-8">
          <AvatarImage src={u.image ?? undefined} alt={displayName} />
          <AvatarFallback><UsersIcon /></AvatarFallback>
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

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20" aria-busy="true">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  )
}

function ActiveFiltersBar({
  filters,
  memberCount,
  hasMorePages,
  onRemoveRole,
  onRemoveCountry,
  onRemoveSkill,
  onRemoveTool,
}: {
  filters: FilterState
  memberCount: number
  hasMorePages: boolean
  onRemoveRole: () => void
  onRemoveCountry: () => void
  onRemoveSkill: (skill: string) => void
  onRemoveTool: (tool: string) => void
}) {
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-2">
      <Badge variant="secondary">
        {memberCount}
        {hasMorePages ? "+" : ""} members
      </Badge>
      {filters.role && <Chip onRemove={onRemoveRole}>Role: {filters.role}</Chip>}
      {filters.country && <Chip onRemove={onRemoveCountry}>Country: {filters.country}</Chip>}
      {filters.skills.map((s) => (
        <Chip key={s} onRemove={() => onRemoveSkill(s)}>
          Skill: {s}
        </Chip>
      ))}
      {filters.tools.map((t) => (
        <Chip key={t} onRemove={() => onRemoveTool(t)}>
          Tool: {t}
        </Chip>
      ))}
    </div>
  )
}

function FiltersPanel({
  filters,
  onFiltersChange,
  onAddSkill,
  onAddTool,
}: {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
  onAddSkill: (skill: string) => void
  onAddTool: (tool: string) => void
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
            placeholder="Name, handle, headline…"
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
              placeholder="Add a skill…"
              items={availableSkills}
              value={null}
              onValueChange={(v) => v && handleAddSkill(v)}
              inputValue={skillQuery}
              onInputValueChange={setSkillQuery}
            />

            {filters.skills.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {filters.skills.map((s) => (
                  <Chip
                    key={s}
                    onRemove={() => onFiltersChange({ skills: filters.skills.filter((x) => x !== s) })}
                  >
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
              onValueChange={(v) => v && handleAddTool(v)}
              inputValue={toolQuery}
              onInputValueChange={setToolQuery}
              emptyMessage={`Press Enter to add "${toolQuery.trim() || "…"}".`}
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
                  <Chip
                    key={t}
                    onRemove={() => onFiltersChange({ tools: filters.tools.filter((x) => x !== t) })}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function MembersGrid({ items, view }: { items: CommunityMember[]; view: "cards" | "list" }) {
  if (view === "cards") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((m) => (
          <MemberCard key={m.membershipId} member={m} />
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

function EmptyState({ hasFilters, onClearFilters }: { hasFilters: boolean; onClearFilters: () => void }) {
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

// === MAIN COMPONENT ===

export default function CommunityMembersPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const communityHandle = params.handle?.trim() || ""

  const [view, setView] = React.useState<"cards" | "list">("cards")
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)

  const [filters, setFilters] = React.useState<FilterState>({
    q: "",
    role: "",
    country: "",
    skills: [],
    tools: [],
    headline: "",
    bio: "",
  })

  const { data, items, loading, loadingMore, error } = useMembersData(communityHandle, filters, cursor)

  const activeFilters = hasActiveFilters(filters)
  const communityName = data?.community?.name || "Community"

  // Reset paging when filters change
  React.useEffect(() => {
    setCursor(null)
  }, [
    filters.q,
    filters.role,
    filters.country,
    filters.skills,
    filters.tools,
    filters.headline,
    filters.bio,
  ])

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters({
      q: "",
      role: "",
      country: "",
      skills: [],
      tools: [],
      headline: "",
      bio: "",
    })
  }

  function handleAddSkill(skill: string) {
    setFilters((prev) => ({ ...prev, skills: [...prev.skills, skill] }))
  }

  function handleAddTool(tool: string) {
    setFilters((prev) => ({ ...prev, tools: [...prev.tools, tool] }))
  }

  function handleRemoveSkill(skill: string) {
    setFilters((prev) => ({ ...prev, skills: prev.skills.filter((s) => s !== skill) }))
  }

  function handleRemoveTool(tool: string) {
    setFilters((prev) => ({ ...prev, tools: prev.tools.filter((t) => t !== tool) }))
  }

  if (!communityHandle) return null

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <PageHeader
        leading={
          <Avatar className="h-12 w-12">
            <AvatarImage src={data?.community?.avatarUrl ?? undefined} alt={communityName} />
            <AvatarFallback><UsersIcon /></AvatarFallback>
          </Avatar>
        }
        title="Members"
        description={`/c/${communityHandle}`}
        actions={
          <div className="flex items-center gap-2">
            <Tabs className="gap-0" value={view} onValueChange={(v) => setView(v === "list" ? "list" : "cards")}>
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

            {activeFilters && (
              <Button type="button" variant="ghost" onClick={handleClearAll}>
                Reset
              </Button>
            )}
          </div>
        }
      />

      <ActiveFiltersBar
        filters={filters}
        memberCount={items.length}
        hasMorePages={!!data?.page?.nextCursor}
        onRemoveRole={() => handleFiltersChange({ role: "" })}
        onRemoveCountry={() => handleFiltersChange({ country: "" })}
        onRemoveSkill={handleRemoveSkill}
        onRemoveTool={handleRemoveTool}
      />

      {isFiltersOpen && (
        <FiltersPanel
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onAddSkill={handleAddSkill}
          onAddTool={handleAddTool}
        />
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
        {loading ? "Loading members..." : `${items.length} members loaded`}
      </div>

      {loading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState hasFilters={activeFilters} onClearFilters={handleClearAll} />
      ) : (
        <InfiniteScroll
          onLoadMore={() => setCursor(data?.page?.nextCursor ?? null)}
          hasMore={!!data?.page?.nextCursor}
          isLoading={loadingMore}
        >
          <MembersGrid items={items} view={view} />
        </InfiniteScroll>
      )}
    </main>
  )
}
"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { ROUTES, userPath, communityPath, communityMembersPath, communityOrbitPath, communitySettingsPath } from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { PageHeaderMenu } from "@/components/common/page-header-menu"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

// === TYPES ===

type ApplicationUser = {
  handle: string
  name?: string | null
  image?: string | null
  createdAt?: string | Date
}

type ApplicationItem = {
  id: string
  status?: string | null
  createdAt: string | Date
  reviewedAt?: string | Date | null
  reviewNote?: string | null
  user: ApplicationUser
  answers?: unknown
}

type CommunityInfo = {
  id: string
  handle: string
  name: string
  avatarUrl?: string | null
}

type ReviewListResponse = {
  community: CommunityInfo
  applications: ApplicationItem[]
}

type DecisionAction = "approve" | "reject" | "ban"

// === STATUS CONFIG ===

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-amber-500/10 text-amber-500" },
  APPROVED: { label: "Approved", className: "bg-emerald-500/10 text-emerald-500" },
  REJECTED: { label: "Rejected", className: "bg-destructive/10 text-destructive" },
  BANNED: { label: "Banned", className: "bg-destructive/10 text-destructive" },
}

// === UTILITY FUNCTIONS ===

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function formatRelativeTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return "—"

  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return formatDate(value)
}

function parseAnswers(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object") return []

  const rec = value as Record<string, unknown>
  return Object.entries(rec)
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string])
    .filter(([, v]) => String(v || "").trim())
}

function normalizeStatus(status: string | null | undefined): string {
  return String(status || "PENDING").toUpperCase()
}

function isProcessedStatus(status: string | null | undefined): boolean {
  const s = normalizeStatus(status)
  return s === "APPROVED" || s === "REJECTED" || s === "BANNED"
}

function getDisplayName(user: ApplicationUser): string {
  return String(user?.name || "").trim() || `@${user.handle}`
}

function sortApplicationsByDate(applications: ApplicationItem[]): ApplicationItem[] {
  return [...applications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

// === FILTER STATE ===

type FilterState = {
  q: string
  status: string // "" = all, "PENDING", "APPROVED", "REJECTED", "BANNED"
  sort: "newest" | "oldest"
}

const EMPTY_FILTERS: FilterState = {
  q: "",
  status: "",
  sort: "newest",
}

function hasActiveFilters(filters: FilterState): boolean {
  return Boolean(filters.q || filters.status)
}

function applyFilters(items: ApplicationItem[], filters: FilterState): ApplicationItem[] {
  let result = items

  // Status filter
  if (filters.status) {
    result = result.filter((a) => normalizeStatus(a.status) === filters.status)
  }

  // Search filter
  const needle = filters.q.trim().toLowerCase()
  if (needle) {
    result = result.filter((a) => {
      const handle = String(a.user?.handle || "").toLowerCase()
      const name = String(a.user?.name || "").toLowerCase()
      return handle.includes(needle) || name.includes(needle)
    })
  }

  // Sort
  result = [...result].sort((a, b) => {
    const at = new Date(a.createdAt).getTime()
    const bt = new Date(b.createdAt).getTime()
    return filters.sort === "newest" ? bt - at : at - bt
  })

  return result
}

// === CUSTOM HOOKS ===

function useApplicationsData(handle: string) {
  const router = useRouter()
  const [data, setData] = React.useState<ReviewListResponse | null>(null)
  const [items, setItems] = React.useState<ApplicationItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const mountedRef = React.useRef(true)

  const loadApplications = React.useCallback(
    async (signal?: AbortSignal) => {
      setError(null)

      const res = await apiGet<ReviewListResponse>(
        "/api/membership/review",
        { communityHandle: handle },
        { signal },
      )

      if (!mountedRef.current || signal?.aborted) return

      if (!res.ok) {
        if (res.error && "code" in res.error && res.error.code === "CLIENT_REQUEST_ABORTED") return

        const parsed = parseApiError(res.error)

        if (parsed.status === 401) {
          router.replace(ROUTES.signIn)
          router.refresh()
          return
        }

        if (parsed.status === 403) {
          router.replace(communityPath(handle))
          router.refresh()
          return
        }

        setError(parsed.formError || "Couldn't load applications.")
        return
      }

      const applications = Array.isArray(res.value.applications) ? res.value.applications : []
      const sorted = sortApplicationsByDate(applications)

      setData(res.value)
      setItems(sorted)
    },
    [handle, router],
  )

  React.useEffect(() => {
    mountedRef.current = true
    const ac = new AbortController()

    loadApplications(ac.signal).finally(() => {
      if (mountedRef.current) {
        setLoading(false)
      }
    })

    return () => {
      mountedRef.current = false
      ac.abort()
    }
  }, [loadApplications])

  return {
    data,
    items,
    setItems,
    loading,
    error,
    loadApplications,
    mountedRef,
  }
}

function useApplicationDialog() {
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState<ApplicationItem | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<"reject" | "ban" | null>(null)
  const [dialogError, setDialogError] = React.useState<string | null>(null)
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const openDialog = React.useCallback((app: ApplicationItem) => {
    setActive(app)
    setDialogError(null)
    setConfirmAction(null)
    setOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setOpen(false)
    setDialogError(null)
    setConfirmAction(null)
    setTimeout(() => {
      if (mountedRef.current) {
        setActive(null)
      }
    }, 200)
  }, [])

  return {
    open,
    active,
    setActive,
    confirmAction,
    setConfirmAction,
    dialogError,
    setDialogError,
    openDialog,
    closeDialog,
    mountedRef,
  }
}

// === SKELETON ===

function ApplicationsSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      {/* PageHeader skeleton */}
      <div className="w-full flex flex-wrap gap-3 p-5">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex gap-2 ml-auto sm:align-center sm:justify-end">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>

      {/* Applications list skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-14 hidden sm:block" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// === SUB-COMPONENTS ===

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = normalizeStatus(status)
  const config = STATUS_CONFIG[s] ?? STATUS_CONFIG.PENDING
  return (
    <Badge variant="secondary" className={`shrink-0 ${config.className}`}>
      {config.label}
    </Badge>
  )
}

function FiltersPanel({
  filters,
  onFiltersChange,
  total,
  filtered,
}: {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
  total: number
  filtered: number
}) {
  return (
    <Card className="bg-card/30 border-border/30">
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name or handle…"
            value={filters.q}
            onChange={(e) => onFiltersChange({ q: e.target.value })}
            aria-label="Search applications"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Status</div>
          <Select
            value={filters.status || null}
            onValueChange={(v) => onFiltersChange({ status: (v ?? "") as string })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) => {
                  if (!v) return "All statuses"
                  return STATUS_CONFIG[v]?.label ?? v
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>All statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="BANNED">Banned</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Sort</div>
          <Select
            value={filters.sort}
            onValueChange={(v) => onFiltersChange({ sort: v as FilterState["sort"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) => v === "oldest" ? "Oldest first" : "Newest first"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters(filters) && (
          <>
            <Separator className="sm:col-span-3" />
            <div className="flex items-center justify-center gap-2 sm:col-span-3">
              <Badge variant="secondary">
                {filtered} of {total} applications
              </Badge>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => onFiltersChange(EMPTY_FILTERS)}
              >
                Clear filters
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ApplicationRow({
  app,
  onRowClick,
}: {
  app: ApplicationItem
  onRowClick: (app: ApplicationItem) => void
}) {
  const user = app.user
  const display = getDisplayName(user)

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3 cursor-pointer hover:bg-card/50 transition-colors"
      onClick={() => onRowClick(app)}
    >
      <Link
        href={userPath(user.handle)}
        className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <ProfileAvatar type="user" src={user.image ?? null} name={display} size="default" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{display}</div>
          <div className="truncate text-xs text-muted-foreground">@{user.handle}</div>
        </div>
      </Link>

      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={app.status} />
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {formatRelativeTime(app.createdAt)}
        </span>
      </div>
    </div>
  )
}

function ApplicationsList({
  applications,
  onRowClick,
}: {
  applications: ApplicationItem[]
  onRowClick: (app: ApplicationItem) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Membership requests</CardTitle>
        <CardDescription>Review and manage applications. Click a row to see answers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {applications.length > 0 ? (
          applications.map((app) => (
            <ApplicationRow
              key={app.id}
              app={app}
              onRowClick={onRowClick}
            />
          ))
        ) : (
          <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
            No applications found.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ApplicationDialog({
  open,
  active,
  confirmAction,
  dialogError,
  acting,
  onClose,
  onDecide,
}: {
  open: boolean
  active: ApplicationItem | null
  confirmAction: "reject" | "ban" | null
  dialogError: string | null
  acting: DecisionAction | null
  onClose: () => void
  onDecide: (app: ApplicationItem, decision: DecisionAction) => void
}) {
  const processed = active ? isProcessedStatus(active.status) : false
  const isBanned = normalizeStatus(active?.status) === "BANNED"

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl [&_a:focus-visible]:outline-none [&_button:focus-visible]:outline-none [&_a:focus-visible]:ring-0 [&_button:focus-visible]:ring-0" showCloseButton={false} initialFocus={false}>
        <div className="flex items-center gap-3">
          {active && (
            <Link
              href={userPath(active.user.handle)}
              className="hover:opacity-80 transition-opacity shrink-0"
            >
              <ProfileAvatar type="user" src={active.user.image ?? null} name={getDisplayName(active.user)} className="h-12 w-12" />
            </Link>
          )}

          <DialogHeader className="flex-1 min-w-0">
            <DialogTitle>
              {active ? `${getDisplayName(active.user)}'s application` : "Application"}
            </DialogTitle>
            <DialogDescription>
              {active ? `Submitted on ${formatDate(active.createdAt)} by @${active.user.handle}` : ""}
            </DialogDescription>
          </DialogHeader>
        </div>

        {active && (
          <div className="flex flex-col gap-5">
            <div className="rounded-lg border border-border/60 p-4 flex flex-col gap-4">
              {parseAnswers(active.answers).length > 0 ? (
                parseAnswers(active.answers).map(([question, answer]) => (
                  <div key={question} className="flex flex-col gap-1">
                    <div className="text-xs font-medium text-muted-foreground">{question}</div>
                    <div className="text-sm whitespace-pre-wrap break-words">{answer}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground text-center">No answers provided.</div>
              )}
            </div>

            {processed && (
              <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={active.status} />
                  {active.reviewedAt && (
                    <span className="text-xs text-muted-foreground">
                      on {formatDate(active.reviewedAt)}
                    </span>
                  )}
                </div>
                {active.reviewNote && (
                  <div className="text-sm whitespace-pre-wrap break-words mt-1">{active.reviewNote}</div>
                )}
              </div>
            )}

            {dialogError && (
              <Alert variant="destructive">
                <AlertDescription>{dialogError}</AlertDescription>
              </Alert>
            )}

            {confirmAction && (
              <Alert variant="destructive">
                <AlertDescription>
                  {confirmAction === "ban"
                    ? "Are you sure you want to ban this user? They will not be able to reapply. Click \"Ban\" again to confirm."
                    : "Are you sure you want to reject this application? Click \"Reject\" again to confirm."}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-3">
          {active && !isBanned ? (
            <Button
              type="button"
              variant="destructive"
              disabled={acting !== null}
              onClick={() => onDecide(active, "ban")}
            >
              {acting === "ban" ? "Banning…" : confirmAction === "ban" ? "Confirm Ban" : "Ban"}
            </Button>
          ) : active ? (
            <StatusBadge status={active.status} />
          ) : <div />}

          {active && !processed ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={acting !== null}
                onClick={() => onDecide(active, "reject")}
              >
                {acting === "reject" ? "Rejecting…" : confirmAction === "reject" ? "Confirm Reject" : "Reject"}
              </Button>
              <Button
                type="button"
                disabled={acting !== null}
                onClick={() => onDecide(active, "approve")}
              >
                {acting === "approve" ? "Approving…" : "Approve"}
              </Button>
            </div>
          ) : active ? (
            <StatusBadge status={active.status} />
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// === MAIN COMPONENT ===

export default function CommunityApplicationsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

  const { data, items, setItems, loading, error, loadApplications, mountedRef } =
    useApplicationsData(handle)

  const {
    open,
    active,
    setActive,
    confirmAction,
    setConfirmAction,
    dialogError,
    setDialogError,
    openDialog,
    closeDialog,
  } = useApplicationDialog()

  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [acting, setActing] = React.useState<DecisionAction | null>(null)
  const [actingId, setActingId] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => applyFilters(items, filters), [items, filters])

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  async function handleDecide(app: ApplicationItem, decision: DecisionAction) {
    if (!app?.id) return

    // Require confirmation for reject and ban
    if ((decision === "reject" || decision === "ban") && confirmAction !== decision) {
      setConfirmAction(decision)
      return
    }

    setActing(decision)
    setActingId(app.id)
    setDialogError(null)

    const previousStatus = app.status
    const newStatus = decision === "approve" ? "APPROVED" : decision === "ban" ? "BANNED" : "REJECTED"

    // Optimistic update
    setItems((prev) => prev.map((x) => (x.id === app.id ? { ...x, status: newStatus } : x)))

    if (active?.id === app.id) {
      setActive({ ...app, status: newStatus })
    }

    const res = await apiPost<{ ok: true }>("/api/membership/review", {
      applicationId: app.id,
      decision: decision === "approve" ? "APPROVE" : decision === "ban" ? "BAN" : "REJECT",
    })

    if (!mountedRef.current) return

    setActing(null)
    setActingId(null)

    if (res.ok) {
      closeDialog()
      return
    }

    // Revert optimistic update on error
    setItems((prev) => prev.map((x) => (x.id === app.id ? { ...x, status: previousStatus } : x)))

    if (active?.id === app.id) {
      setActive({ ...app, status: previousStatus })
    }

    const err = res.error
    const parsed = parseApiError(err)

    if (parsed.status === 401) {
      router.replace(ROUTES.signIn)
      router.refresh()
      return
    }

    if (parsed.status === 403) {
      router.replace(communityPath(handle))
      router.refresh()
      return
    }

    setDialogError(parsed.formError || "Couldn't update application.")
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await loadApplications()
    } finally {
      if (mountedRef.current) {
        setRefreshing(false)
      }
    }
  }

  if (!handle) return null

  if (loading || !data) {
    return <ApplicationsSkeleton />
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar
            type="community"
            src={data?.community?.avatarUrl}
            name={data?.community?.name}
            className="h-12 w-12"
          />
        }
        title="Applications"
        description={`@${handle}`}
        actionsAsFormActions={false}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setIsFiltersOpen((v) => !v)}>
              {isFiltersOpen ? "Hide filters" : "Show filters"}
            </Button>
            <Button type="button" variant="secondary" disabled={refreshing} onClick={handleRefresh}>
              {refreshing && <RefreshCw className="size-4 animate-spin" />}
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <PageHeaderMenu
              items={[
                { label: "Profile", href: communityPath(handle) },
                { label: "Members", href: communityMembersPath(handle) },
                { label: "Orbit", href: communityOrbitPath(handle) },
                { label: "Settings", href: communitySettingsPath(handle) },
              ]}
            />
          </div>
        }
      />

      {isFiltersOpen && (
        <FiltersPanel
          filters={filters}
          onFiltersChange={handleFiltersChange}
          total={items.length}
          filtered={filtered.length}
        />
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ApplicationsList
        applications={filtered}
        onRowClick={openDialog}
      />

      <ApplicationDialog
        open={open}
        active={active}
        confirmAction={confirmAction}
        dialogError={dialogError}
        acting={acting}
        onClose={closeDialog}
        onDecide={handleDecide}
      />
    </div>
  )
}

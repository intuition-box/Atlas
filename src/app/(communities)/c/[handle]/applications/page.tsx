"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiClientError, parseApiProblem } from "@/lib/api/errors"
import { ROUTES, userPath } from "@/lib/routes"
import { PageHeader } from "@/components/common/page-header"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { UsersIcon } from "@/components/ui/icons"

// === TYPES ===

type ApplicationStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "BANNED"

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

type DecisionAction = "approve" | "reject"

// === UTILITY FUNCTIONS ===

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function parseAnswers(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object") return []

  const rec = value as Record<string, unknown>
  return Object.entries(rec)
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string])
    .filter(([, v]) => String(v || "").trim())
}

function isProcessedStatus(status: string | null | undefined): boolean {
  const normalized = String(status || "").toUpperCase()
  return normalized === "APPROVED" || normalized === "REJECTED"
}

function getDisplayName(user: ApplicationUser): string {
  return String(user?.name || "").trim() || `@${user.handle}`
}

function extractUniqueHandles(applications: ApplicationItem[]): string[] {
  const set = new Set<string>()
  for (const app of applications) {
    if (app?.user?.handle) {
      set.add(String(app.user.handle))
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

function filterApplications(
  applications: ApplicationItem[],
  query: string,
  selectedHandle: string | null
): ApplicationItem[] {
  const needle = String(selectedHandle || query || "").trim().toLowerCase()
  if (!needle) return applications

  return applications.filter((app) => {
    const handle = String(app.user?.handle || "").toLowerCase()
    const name = String(app.user?.name || "").toLowerCase()
    return handle.includes(needle) || name.includes(needle)
  })
}

function sortApplicationsByDate(applications: ApplicationItem[]): ApplicationItem[] {
  return [...applications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
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

      try {
        const res = await apiGet<ReviewListResponse>(
          "/api/membership/review",
          { communityHandle: handle },
          { signal }
        )

        if (!mountedRef.current) return

        if (!res.ok) {
          const err = res.error
          const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)

          if (parsed.status === 401) {
            router.replace(ROUTES.signIn)
            router.refresh()
            return
          }

          if (parsed.status === 403) {
            router.replace(`/c/${handle}`)
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
      } catch (err) {
        if (!mountedRef.current) return
        setError("An unexpected error occurred while loading applications.")
      }
    },
    [handle, router]
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
  const [confirmReject, setConfirmReject] = React.useState(false)
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
    setConfirmReject(false)
    setOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setOpen(false)
    setDialogError(null)
    setConfirmReject(false)
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
    confirmReject,
    setConfirmReject,
    dialogError,
    setDialogError,
    openDialog,
    closeDialog,
    mountedRef,
  }
}

// === SUB-COMPONENTS ===

function FilterBar({
  count,
  communityName,
  handleOptions,
  query,
  selectedHandle,
  onQueryChange,
  onSelectedHandleChange,
  onClear,
}: {
  count: number
  communityName?: string
  handleOptions: string[]
  query: string
  selectedHandle: string | null
  onQueryChange: (value: string) => void
  onSelectedHandleChange: (value: string | null) => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{count} applications</Badge>
        {communityName && (
          <span className="text-sm text-muted-foreground">for {communityName}</span>
        )}
      </div>

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
        <div className="w-full sm:w-[320px]">
          <Combobox
            items={handleOptions}
            value={selectedHandle}
            inputValue={query}
            onInputValueChange={(v) => {
              onQueryChange(String(v ?? ""))
              onSelectedHandleChange(null)
            }}
            onValueChange={(v) => {
              if (typeof v !== "string") return
              onSelectedHandleChange(v)
              onQueryChange(v)
            }}
          >
            <ComboboxInput placeholder="Filter by username…" className="w-full" showTrigger />

            <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
              <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">
                No matches.
              </ComboboxEmpty>
              <ComboboxList className="max-h-64 overflow-auto">
                <ComboboxCollection>
                  {(item: string) => (
                    <ComboboxItem
                      key={item}
                      value={item}
                      className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
                    >
                      <span className="flex-1">@{item}</span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>

        {(query.trim() || selectedHandle) && (
          <Button type="button" variant="secondary" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}

function ApplicationsTable({
  applications,
  loading,
  actingId,
  acting,
  onRowClick,
  onRowReject,
  onDecide,
  onViewProfile,
}: {
  applications: ApplicationItem[]
  loading: boolean
  actingId: string | null
  acting: DecisionAction | null
  onRowClick: (app: ApplicationItem) => void
  onRowReject: (app: ApplicationItem) => void
  onDecide: (app: ApplicationItem, decision: DecisionAction) => void
  onViewProfile: (handle: string) => void
}) {

  return (
    <div className="rounded-2xl border border-border/60 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Account created</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : applications.length > 0 ? (
            applications.map((app) => {
              const user = app.user
              const display = getDisplayName(user)
              const processed = isProcessedStatus(app.status)
              const isActing = actingId === app.id

              return (
                <TableRow
                  key={app.id}
                  className="cursor-pointer"
                  onClick={() => onRowClick(app)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={user.image || undefined} alt={display} />
                        <AvatarFallback><UsersIcon /></AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{display}</div>
                        <div className="truncate text-xs text-muted-foreground">@{user.handle}</div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {user.createdAt ? formatDate(user.createdAt) : "—"}
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(app.createdAt)}
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        String(app.status || "").toUpperCase() === "PENDING" ? "secondary" : "outline"
                      }
                    >
                      {String(app.status || "PENDING")}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-right">
                    <div
                      className="flex items-center justify-end gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onViewProfile(user.handle)}
                      >
                        Profile ↗
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isActing || processed}
                        onClick={() => onDecide(app, "approve")}
                      >
                        {isActing && acting === "approve" ? "Approving…" : "Approve ✓"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isActing || processed}
                        onClick={() => onRowReject(app)}
                      >
                        {isActing && acting === "reject" ? "Rejecting…" : "Reject ✕"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })
          ) : (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                No applications.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function ApplicationDialog({
  open,
  active,
  confirmReject,
  dialogError,
  acting,
  onClose,
  onDecide,
  onViewProfile,
}: {
  open: boolean
  active: ApplicationItem | null
  confirmReject: boolean
  dialogError: string | null
  acting: DecisionAction | null
  onClose: () => void
  onDecide: (app: ApplicationItem, decision: DecisionAction) => void
  onViewProfile: (handle: string) => void
}) {
  const router = useRouter()
  const processed = active ? isProcessedStatus(active.status) : false

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Application</DialogTitle>
          <DialogDescription>Review answers and take action.</DialogDescription>
        </DialogHeader>

        {active && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={active.user.image || undefined} alt={active.user.handle} />
                <AvatarFallback><UsersIcon /></AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">@{active.user.handle}</div>
                <div className="text-xs text-muted-foreground">
                  Submitted {formatDate(active.createdAt)}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 p-4">
              <div className="text-sm font-medium">Answers</div>
              <div className="mt-3 flex flex-col gap-3">
                {parseAnswers(active.answers).length > 0 ? (
                  parseAnswers(active.answers).map(([k, v]) => (
                    <div key={k} className="flex flex-col gap-1">
                      <div className="text-xs text-muted-foreground">{k}</div>
                      <div className="text-sm whitespace-pre-wrap break-words">{v}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">No answers provided.</div>
                )}
              </div>
            </div>

            {dialogError && (
              <div
                className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert"
              >
                {dialogError}
              </div>
            )}

            {confirmReject && (
              <div
                className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
                role="alert"
              >
                Are you sure you want to reject this application? Click "Reject" again to confirm.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-6 flex-col-reverse sm:flex-row sm:justify-between gap-3">
          <DialogClose>
            <Button type="button" variant="secondary" className="w-full sm:w-auto">
              Close
            </Button>
          </DialogClose>

          {active && !processed ? (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-initial"
                onClick={() => onViewProfile(active.user.handle)}
              >
                Profile ↗
              </Button>
              <Button
                type="button"
                disabled={acting !== null}
                onClick={() => onDecide(active, "approve")}
                className="flex-1 sm:flex-initial"
              >
                {acting === "approve" ? "Approving…" : "Approve"}
              </Button>
              <Button
                type="button"
                variant={confirmReject ? "destructive" : "outline"}
                disabled={acting !== null}
                onClick={() => onDecide(active, "reject")}
                className="flex-1 sm:flex-initial"
              >
                {acting === "reject" ? "Rejecting…" : confirmReject ? "Confirm Reject" : "Reject"}
              </Button>
            </div>
          ) : active ? (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-initial"
                onClick={() => onViewProfile(active.user.handle)}
              >
                View Profile ↗
              </Button>
              <Badge variant="outline" className="px-3 py-1">
                {String(active.status || "PENDING")}
              </Badge>
            </div>
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
    confirmReject,
    setConfirmReject,
    dialogError,
    setDialogError,
    openDialog,
    closeDialog,
  } = useApplicationDialog()

  const [query, setQuery] = React.useState("")
  const [selectedHandle, setSelectedHandle] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [acting, setActing] = React.useState<DecisionAction | null>(null)
  const [actingId, setActingId] = React.useState<string | null>(null)

  // --- HEADER STATE ---
  const [showFilters, setShowFilters] = React.useState(false)
  const [showProcessed, setShowProcessed] = React.useState(false)
  const [sortOrder, setSortOrder] = React.useState<"newest" | "oldest">("newest")

  // --- FILTER & SORT PIPELINE ---
  const baseItems = React.useMemo(() => {
    return showProcessed ? items : items.filter((a) => !isProcessedStatus(a.status))
  }, [items, showProcessed])

  const handleOptions = React.useMemo(() => extractUniqueHandles(baseItems), [baseItems])

  const filtered = React.useMemo(() => {
    const subset = filterApplications(baseItems, query, selectedHandle)
    const sorted = [...subset].sort((a, b) => {
      const at = new Date(a.createdAt).getTime()
      const bt = new Date(b.createdAt).getTime()
      return sortOrder === "newest" ? bt - at : at - bt
    })
    return sorted
  }, [baseItems, query, selectedHandle, sortOrder])

  async function handleDecide(app: ApplicationItem, decision: DecisionAction) {
    if (!app?.id) return

    if (decision === "reject" && !confirmReject) {
      setConfirmReject(true)
      return
    }

    setActing(decision)
    setActingId(app.id)
    setDialogError(null)

    const previousStatus = app.status
    const newStatus = decision === "approve" ? "APPROVED" : "REJECTED"

    // Optimistic update
    setItems((prev) => prev.map((x) => (x.id === app.id ? { ...x, status: newStatus } : x)))

    if (active?.id === app.id) {
      setActive({ ...app, status: newStatus })
    }

    const res = await apiPost<{ ok: true }>("/api/membership/review", {
      applicationId: app.id,
      decision: decision === "approve" ? "APPROVE" : "REJECT",
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
    const parsed = "issues" in err ? parseApiProblem(err) : parseApiClientError(err)

    if (parsed.status === 401) {
      router.replace(ROUTES.signIn)
      router.refresh()
      return
    }

    if (parsed.status === 403) {
      router.replace(`/c/${handle}`)
      router.refresh()
      return
    }

    setDialogError(parsed.formError || "Couldn't update application.")
  }

  function handleClear() {
    setQuery("")
    setSelectedHandle(null)
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

  function handleViewProfile(userHandle: string) {
    router.push(userPath(userHandle))
  }

  function handleRowReject(app: ApplicationItem) {
    openDialog(app)
    setConfirmReject(true)
  }

  if (!handle) return null

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <PageHeader
        leading={
          <Avatar className="h-12 w-12">
            <AvatarImage src={data?.community?.avatarUrl ?? undefined} alt={data?.community?.name} />
            <AvatarFallback><UsersIcon /></AvatarFallback>
          </Avatar>
        }
        title="Applications"
        description={`/c/${handle}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant={showFilters ? "default" : "secondary"}
              onClick={() => setShowFilters((v) => !v)}
            >
              Filters
            </Button>
            <Button
              type="button"
              variant={showProcessed ? "default" : "secondary"}
              onClick={() => setShowProcessed((v) => !v)}
            >
              {showProcessed ? "Hide processed" : "Show processed"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSortOrder((v) => (v === "newest" ? "oldest" : "newest"))}
            >
              Sort: {sortOrder === "newest" ? "Newest" : "Oldest"}
            </Button>
            <Button type="button" variant="secondary" disabled={refreshing} onClick={handleRefresh}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        }
      />

      <p className="text-sm text-muted-foreground">
        Review membership applications for this community. Click a row to see answers.
      </p>

      {showFilters ? (
        <FilterBar
          count={filtered.length}
          communityName={data?.community?.name}
          handleOptions={handleOptions}
          query={query}
          selectedHandle={selectedHandle}
          onQueryChange={setQuery}
          onSelectedHandleChange={setSelectedHandle}
          onClear={handleClear}
        />
      ) : (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{filtered.length} applications</Badge>
          {(query.trim() || selectedHandle) ? (
            <Button type="button" variant="secondary" onClick={handleClear}>
              Clear filter
            </Button>
          ) : null}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      <ApplicationsTable
        applications={filtered}
        loading={loading}
        actingId={actingId}
        acting={acting}
        onRowClick={openDialog}
        onRowReject={handleRowReject}
        onDecide={handleDecide}
        onViewProfile={handleViewProfile}
      />

      <ApplicationDialog
        open={open}
        active={active}
        confirmReject={confirmReject}
        dialogError={dialogError}
        acting={acting}
        onClose={closeDialog}
        onDecide={handleDecide}
        onViewProfile={handleViewProfile}
      />
    </main>
  )
}
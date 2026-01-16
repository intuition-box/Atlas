"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"

import { apiGet, apiPost } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"
import { ROUTES, userPath } from "@/lib/routes"

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

type ReviewListResponse = {
  community: { id: string; handle: string; name: string; avatarUrl?: string | null }
  applications: ApplicationItem[]
}

function formatDate(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function safeObjectEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object") return []
  const rec = value as Record<string, unknown>
  return Object.entries(rec)
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string])
    .filter(([, v]) => String(v || "").trim())
}

export default function CommunityApplicationsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogError, setDialogError] = React.useState<string | null>(null)

  const [data, setData] = React.useState<ReviewListResponse | null>(null)
  const [items, setItems] = React.useState<ApplicationItem[]>([])

  const [query, setQuery] = React.useState("")
  const [selectedHandle, setSelectedHandle] = React.useState<string | null>(null)

  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState<ApplicationItem | null>(null)
  const [acting, setActing] = React.useState<"approve" | "reject" | null>(null)
  const [actingId, setActingId] = React.useState<string | null>(null)
  const [confirmReject, setConfirmReject] = React.useState(false)

  // Ref to track if component is mounted
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function load(signal?: AbortSignal) {
    setError(null)

    const res = await apiGet<ReviewListResponse>(
      "/api/membership/review",
      {
        communityHandle: handle,
      },
      { signal },
    )

    if (!mountedRef.current) return

    if (res.ok) {
      const next = res.value
      const apps = Array.isArray(next.applications) ? next.applications : []

      // Default: newest first (submission date)
      apps.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      setData(next)
      setItems(apps)
      return
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

    setError(parsed.formError || "Couldn't load applications.")
  }

  React.useEffect(() => {
    const ac = new AbortController()

    void (async () => {
      try {
        await load(ac.signal)
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    })()

    return () => {
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle])

  const handleOptions = React.useMemo(() => {
    const set = new Set<string>()
    for (const a of items) {
      if (a?.user?.handle) set.add(String(a.user.handle))
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [items])

  const filtered = React.useMemo(() => {
    const needle = String(selectedHandle || query || "").trim().toLowerCase()
    if (!needle) return items

    return items.filter((a) => {
      const h = String(a.user?.handle || "").toLowerCase()
      const n = String(a.user?.name || "").toLowerCase()
      return h.includes(needle) || n.includes(needle)
    })
  }, [items, query, selectedHandle])

  function openDialog(app: ApplicationItem) {
    setActive(app)
    setDialogError(null)
    setConfirmReject(false)
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
    setDialogError(null)
    setConfirmReject(false)
    // Delay clearing active to prevent flash during close animation
    setTimeout(() => {
      if (mountedRef.current) {
        setActive(null)
      }
    }, 200)
  }

  async function decide(app: ApplicationItem, decision: "approve" | "reject") {
    if (!app?.id) return

    if (decision === "reject" && !confirmReject) {
      setConfirmReject(true)
      return
    }

    setActing(decision)
    setActingId(app.id)
    setDialogError(null)

    // Optimistic update
    const previousStatus = app.status
    const newStatus = decision === "approve" ? "APPROVED" : "REJECTED"

    setItems((prev) =>
      prev.map((x) => (x.id === app.id ? { ...x, status: newStatus } : x)),
    )

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
      // Success - optimistic update already applied
      closeDialog()
      return
    }

    // Revert optimistic update on error
    setItems((prev) =>
      prev.map((x) => (x.id === app.id ? { ...x, status: previousStatus } : x)),
    )

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

  const isProcessed = (app: ApplicationItem) => {
    const status = String(app.status || "").toUpperCase()
    return status === "APPROVED" || status === "REJECTED"
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Applications</h1>
        <p className="text-sm text-muted-foreground">
          Review membership applications for this community. Click a row to see answers.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{filtered.length} applications</Badge>
          {data?.community?.name ? <span className="text-sm text-muted-foreground">for {data.community.name}</span> : null}
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <div className="w-full sm:w-[320px]">
            <Combobox
              items={handleOptions}
              value={selectedHandle}
              inputValue={query}
              onInputValueChange={(v) => {
                setQuery(String(v ?? ""))
                setSelectedHandle(null)
              }}
              onValueChange={(v) => {
                if (typeof v !== "string") return
                setSelectedHandle(v)
                setQuery(v)
              }}
            >
              <ComboboxInput
                placeholder="Filter by username…"
                className="w-full"
                showClear
                showTrigger
              />

              <ComboboxContent className="bg-popover text-popover-foreground border border-border/60 shadow-lg rounded-2xl p-1">
                <ComboboxEmpty className="px-3 py-2 text-sm text-muted-foreground">No matches.</ComboboxEmpty>
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

          {(query.trim() || selectedHandle) ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQuery("")
                setSelectedHandle(null)
              }}
            >
              Clear
            </Button>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              try {
                await load()
              } finally {
                if (mountedRef.current) {
                  setRefreshing(false)
                }
              }
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

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
            ) : filtered.length ? (
              filtered.map((app) => {
                const u = app.user
                const display = String(u?.name || "").trim() || `@${u.handle}`
                const processed = isProcessed(app)
                const isActing = actingId === app.id

                return (
                  <TableRow
                    key={app.id}
                    className="cursor-pointer"
                    onClick={() => openDialog(app)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={u.image || undefined} alt={display} />
                          <AvatarFallback>{String(u.handle || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{display}</div>
                          <div className="truncate text-xs text-muted-foreground">@{u.handle}</div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground">{u.createdAt ? formatDate(u.createdAt) : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(app.createdAt)}</TableCell>

                    <TableCell>
                      <Badge variant={String(app.status || "").toUpperCase() === "PENDING" ? "secondary" : "outline"}>
                        {String(app.status || "PENDING")}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button type="button" variant="ghost" size="sm" onClick={() => router.push(userPath(u.handle))}>
                          Profile ↗
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isActing || processed}
                          onClick={() => decide(app, "approve")}
                        >
                          {isActing && acting === "approve" ? "Approving…" : "Approve ✓"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isActing || processed}
                          onClick={() => {
                            openDialog(app)
                            setConfirmReject(true)
                          }}
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

      <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) {
          closeDialog()
        } else {
          setOpen(true)
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Application</DialogTitle>
            <DialogDescription>Review answers and take action.</DialogDescription>
          </DialogHeader>

          {active ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={active.user.image || undefined} alt={active.user.handle} />
                  <AvatarFallback>{String(active.user.handle || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">@{active.user.handle}</div>
                  <div className="text-xs text-muted-foreground">Submitted {formatDate(active.createdAt)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 p-4">
                <div className="text-sm font-medium">Answers</div>
                <div className="mt-3 flex flex-col gap-3">
                  {safeObjectEntries(active.answers).length ? (
                    safeObjectEntries(active.answers).map(([k, v]) => (
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

              {dialogError ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                  {dialogError}
                </div>
              ) : null}

              {confirmReject ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400" role="alert">
                  Are you sure you want to reject this application? Click "Reject" again to confirm.
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="mt-6 flex-col-reverse sm:flex-row sm:justify-between gap-3">
            <DialogClose asChild>
              <Button type="button" variant="secondary" className="w-full sm:w-auto">
                Close
              </Button>
            </DialogClose>

            {active && !isProcessed(active) ? (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-initial"
                  onClick={() => router.push(userPath(active.user.handle))}
                >
                  Profile ↗
                </Button>
                <Button
                  type="button"
                  disabled={acting !== null}
                  onClick={() => decide(active, "approve")}
                  className="flex-1 sm:flex-initial"
                >
                  {acting === "approve" ? "Approving…" : "Approve"}
                </Button>
                <Button
                  type="button"
                  variant={confirmReject ? "destructive" : "outline"}
                  disabled={acting !== null}
                  onClick={() => decide(active, "reject")}
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
                  onClick={() => router.push(userPath(active.user.handle))}
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
    </main>
  )
}
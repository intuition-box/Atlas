"use client"

import * as React from "react"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"

import type { ToolbarAction, ViewSwitch } from "@/components/common/page-toolbar"

// === CANONICAL COMMUNITY DATA TYPE ===

/** The full response shape from `/api/community/get`, used as the single source of truth. */
export type CommunityData = {
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
    ownerId?: string | null
    owner?: { handle?: string | null } | null
    membershipConfig?: unknown
  }
  memberCount: number
  canViewDirectory: boolean
  isAdmin: boolean
  viewerMembership: { status: string; role: string } | null
  orbitMembers: Array<{
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
    image: string | null
    orbitLevel: string
    loveScore?: number
    reachScore?: number
    gravityScore?: number
    headline: string | null
    tags?: string[] | null
    lastActiveAt?: string | null
    joinedAt?: string | null
  }>
}

// === TOOLBAR SLOT ===

export type ToolbarSlotValue = {
  actions?: ToolbarAction[]
  viewSwitch?: ViewSwitch<string>
}

// === CONTEXT VALUE ===

type CommunityStatus = "loading" | "error" | "not-found" | "ready"

export type CommunityContextValue = {
  handle: string

  // Data state
  status: CommunityStatus
  data: CommunityData | null
  errorMessage: string | null

  // Convenience accessors
  community: CommunityData["community"] | null
  isAdmin: boolean
  canViewDirectory: boolean
  viewerMembership: CommunityData["viewerMembership"]
  orbitMembers: CommunityData["orbitMembers"]

  // Toolbar slot — pages inject their own actions/viewSwitch
  toolbarSlot: ToolbarSlotValue | null
  setToolbarSlot: (slot: ToolbarSlotValue | null) => void

  // Header overrides
  headerHidden: boolean
  setHeaderHidden: (hidden: boolean) => void
  leadingOverride: React.ReactNode | null
  setLeadingOverride: (node: React.ReactNode | null) => void

  // Allows orbit to inject prefetched data
  injectData: (data: CommunityData) => void

  // Re-fetch community data (e.g. after settings save)
  refetch: () => void
}

// === CONTEXT ===

const CommunityContext = React.createContext<CommunityContextValue | null>(null)

// === HOOK ===

export function useCommunity(): CommunityContextValue {
  const ctx = React.useContext(CommunityContext)
  if (!ctx) {
    throw new Error("useCommunity must be used within a <CommunityProvider>")
  }
  return ctx
}

// === PREFETCH ===

/** Check for prefetched data from universe zoom (set on window before navigation). */
function consumePrefetch(handle: string): CommunityData | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  const pf = w.__orbitPrefetch as { handle: string; data: CommunityData } | undefined
  if (pf?.handle === handle) {
    delete w.__orbitPrefetch
    return pf.data
  }
  delete w.__orbitPrefetch
  return null
}

// === PROVIDER ===

type CommunityProviderProps = {
  handle: string
  children: React.ReactNode
}

export function CommunityProvider({ handle, children }: CommunityProviderProps) {
  const normalized = React.useMemo(() => normalizeHandle(handle), [handle])

  // Check for orbit prefetch synchronously (consumed once, cached in ref)
  const prefetchRef = React.useRef<CommunityData | null | undefined>(undefined)
  if (prefetchRef.current === undefined) {
    prefetchRef.current = typeof window !== "undefined" ? consumePrefetch(normalized) : null
  }
  const prefetched = prefetchRef.current

  // Core data state
  const [status, setStatus] = React.useState<CommunityStatus>(
    prefetched ? "ready" : "loading",
  )
  const [data, setData] = React.useState<CommunityData | null>(prefetched)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  // Toolbar slot
  const [toolbarSlot, setToolbarSlot] = React.useState<ToolbarSlotValue | null>(null)

  // Header overrides
  const [headerHidden, setHeaderHidden] = React.useState(false)
  const [leadingOverride, setLeadingOverride] = React.useState<React.ReactNode | null>(null)

  // Fetch counter for refetch
  const [fetchKey, setFetchKey] = React.useState(0)

  // Fetch community data
  React.useEffect(() => {
    // Skip if we already have prefetched data on first mount
    if (prefetched && fetchKey === 0) return

    const parsed = validateHandle(normalized)
    if (!parsed.ok) {
      setStatus("not-found")
      return
    }

    const controller = new AbortController()
    setStatus("loading")

    void (async () => {
      const result = await apiGet<CommunityData>(
        "/api/community/get",
        { handle: normalized },
        { signal: controller.signal },
      )

      if (controller.signal.aborted) return

      if (result.ok) {
        setData(result.value)
        setStatus("ready")
        setErrorMessage(null)
        return
      }

      if (result.error && typeof result.error === "object" && "status" in result.error) {
        const parsedErr = parseApiError(result.error)
        if (parsedErr.status === 404) {
          setStatus("not-found")
          return
        }
        setErrorMessage(parsedErr.formError || "Something went wrong.")
        setStatus("error")
        return
      }

      const parsedErr = parseApiError(result.error)
      setErrorMessage(parsedErr.formError || "Something went wrong.")
      setStatus("error")
    })()

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, fetchKey])

  const injectData = React.useCallback((injected: CommunityData) => {
    setData(injected)
    setStatus("ready")
    setErrorMessage(null)
  }, [])

  const refetch = React.useCallback(() => {
    setFetchKey((k) => k + 1)
  }, [])

  const value = React.useMemo<CommunityContextValue>(() => ({
    handle: normalized,
    status,
    data,
    errorMessage,
    community: data?.community ?? null,
    isAdmin: data?.isAdmin ?? false,
    canViewDirectory: data?.canViewDirectory ?? false,
    viewerMembership: data?.viewerMembership ?? null,
    orbitMembers: data?.orbitMembers ?? [],
    toolbarSlot,
    setToolbarSlot,
    headerHidden,
    setHeaderHidden,
    leadingOverride,
    setLeadingOverride,
    injectData,
    refetch,
  }), [
    normalized, status, data, errorMessage,
    toolbarSlot, headerHidden, leadingOverride,
    injectData, refetch,
  ])

  return (
    <CommunityContext.Provider value={value}>
      {children}
    </CommunityContext.Provider>
  )
}

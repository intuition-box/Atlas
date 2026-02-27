"use client"

import * as React from "react"
import { useSession } from "next-auth/react"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"

import type { ToolbarAction, ViewSwitch } from "@/components/common/page-toolbar"

// === CANONICAL USER DATA TYPE ===

/** The full response shape from `/api/user/get`, used as the single source of truth. */
export type UserData = {
  user: {
    id: string
    handle: string | null
    name: string | null
    image: string | null
    avatarUrl: string | null
    headline: string | null
    bio: string | null
    location: string | null
    links: string[] | null
    skills: string[] | null
    tags: string[] | null
    languages: string[] | null
    contactPreference: string | null
    discordId: string | null
    discordHandle: string | null
    twitterHandle: string | null
    githubHandle: string | null
    walletAddresses: string[]
    linkedProviders: string[]
    createdAt: string
    lastActiveAt: string | null
  }
  isSelf: boolean
  attestations: Array<{
    id: string
    type: string
    confidence: number | null
    direction: "given" | "received"
    createdAt: string
    peer: {
      id: string
      name: string | null
      handle: string | null
      image: string | null
      avatarUrl: string | null
    }
  }>
}

// === TOOLBAR SLOT ===

export type ToolbarSlotValue = {
  actions?: ToolbarAction[]
  viewSwitch?: ViewSwitch<string>
}

// === CONTEXT VALUE ===

type UserStatus = "loading" | "error" | "not-found" | "ready"

export type UserContextValue = {
  handle: string

  // Data state
  status: UserStatus
  data: UserData | null
  errorMessage: string | null

  // Convenience accessors
  user: UserData["user"] | null
  isSelf: boolean

  // Toolbar slot — pages inject their own actions/viewSwitch
  toolbarSlot: ToolbarSlotValue | null
  setToolbarSlot: (slot: ToolbarSlotValue | null) => void

  // Header overrides
  leadingOverride: React.ReactNode | null
  setLeadingOverride: (node: React.ReactNode | null) => void

  // Re-fetch user data (e.g. after settings save)
  refetch: () => void
}

// === CONTEXT ===

const UserContext = React.createContext<UserContextValue | null>(null)

// === HOOK ===

export function useUser(): UserContextValue {
  const ctx = React.useContext(UserContext)
  if (!ctx) {
    throw new Error("useUser must be used within a <UserProvider>")
  }
  return ctx
}

// === PROVIDER ===

type UserProviderProps = {
  handle: string
  children: React.ReactNode
}

export function UserProvider({ handle, children }: UserProviderProps) {
  const normalized = React.useMemo(() => normalizeHandle(handle), [handle])
  const { data: session } = useSession()

  // Core data state
  const [status, setStatus] = React.useState<UserStatus>("loading")
  const [data, setData] = React.useState<UserData | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  // Toolbar slot
  const [toolbarSlot, setToolbarSlot] = React.useState<ToolbarSlotValue | null>(null)

  // Header overrides
  const [leadingOverride, setLeadingOverride] = React.useState<React.ReactNode | null>(null)

  // Fetch counter for refetch
  const [fetchKey, setFetchKey] = React.useState(0)

  // Fetch user data
  React.useEffect(() => {
    const parsed = validateHandle(normalized)
    if (!parsed.ok) {
      setStatus("not-found")
      return
    }

    const controller = new AbortController()
    setStatus("loading")

    void (async () => {
      const result = await apiGet<UserData>(
        "/api/user/get",
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

  const refetch = React.useCallback(() => {
    setFetchKey((k) => k + 1)
  }, [])

  // Augment isSelf with client-side session check for robustness
  const isSelf = React.useMemo(() => {
    if (!data) return false
    if (data.isSelf) return true
    return session?.user?.id === data.user.id
  }, [data, session?.user?.id])

  const value = React.useMemo<UserContextValue>(() => ({
    handle: normalized,
    status,
    data,
    errorMessage,
    user: data?.user ?? null,
    isSelf,
    toolbarSlot,
    setToolbarSlot,
    leadingOverride,
    setLeadingOverride,
    refetch,
  }), [
    normalized, status, data, errorMessage, isSelf,
    toolbarSlot, leadingOverride, refetch,
  ])

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  )
}

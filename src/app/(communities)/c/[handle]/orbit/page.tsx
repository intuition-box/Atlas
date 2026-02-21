"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"
import { communityPath, userPath } from "@/lib/routes"

import { OrbitView } from "@/components/orbit/view"
import type { OrbitMember, OrbitCommunityData } from "@/components/orbit/types"

import { OrbitSkeleton } from "@/components/orbit/orbit-skeleton"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"

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
    reachScore: number
    headline: string | null
    tags: string[] | null
    lastActiveAt: string | null
    joinedAt: string | null
  }>
}

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ready"; data: CommunityGetResponse }

// === HELPERS ===

function toOrbitMembers(raw: CommunityGetResponse["orbitMembers"]): OrbitMember[] {
  return raw.map((m) => ({
    id: m.id,
    handle: m.handle,
    name: m.name?.trim() || m.handle || "Unknown",
    avatarUrl: m.avatarUrl || m.image,
    headline: m.headline,
    tags: m.tags ?? [],
    orbitLevel: (m.orbitLevel as OrbitMember["orbitLevel"]) || "EXPLORER",
    loveScore: 0,
    reachScore: m.reachScore,
    lastActiveAt: m.lastActiveAt,
    joinedAt: m.joinedAt,
  }))
}

function toCommunityData(
  data: CommunityGetResponse,
): OrbitCommunityData {
  return {
    id: data.community.id,
    handle: data.community.handle,
    name: data.community.name,
    avatarUrl: data.community.avatarUrl,
    description: data.community.description,
    memberCount: data.memberCount,
    isPublic: data.community.isPublicDirectory,
    isMembershipOpen: data.community.isMembershipOpen,
    isAdmin: data.isAdmin,
    viewerMembership: data.viewerMembership,
  }
}

// === PAGE ===

export default function CommunityOrbitPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const rawHandle = String(params?.handle ?? "")
  const handle = React.useMemo(() => normalizeHandle(rawHandle), [rawHandle])

  const [state, setState] = React.useState<LoadState>({ status: "idle" })

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

  const handleMemberClick = React.useCallback(
    (memberIdOrHandle: string) => {
      router.push(userPath(memberIdOrHandle))
    },
    [router],
  )

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

  // --- LOADING / READY ---
  // Full-screen immersive layout: canvas fills viewport
  // Center avatar is the entry point — clicking it opens the community popover

  const isReady = state.status === "ready"
  const data = isReady ? state.data : null
  const community = data?.community
  const handleLabel = community?.handle ?? handle
  const avatarSrc = community?.avatarUrl ?? ""
  const members = data ? toOrbitMembers(data.orbitMembers) : []
  const canViewDirectory = data?.canViewDirectory ?? false
  const communityData = data ? toCommunityData(data) : undefined

  return (
    <>
      {/* Full-screen orbit canvas */}
      {isReady && canViewDirectory && members.length > 0 ? (
        <OrbitView
          members={members}
          centerLogoUrl={avatarSrc}
          centerName={community?.name}
          isMembershipOpen={community?.isMembershipOpen ?? false}
          isPublicDirectory={community?.isPublicDirectory ?? false}
          community={communityData}
          startFromCenter
          onMemberClick={handleMemberClick}
        />
      ) : null}

      {/* Loading skeleton — rings + pulsing center matching orbit geometry */}
      {!isReady ? (
        <OrbitSkeleton className="pointer-events-none absolute inset-0" />
      ) : null}

      {/* Empty state */}
      {isReady && (!canViewDirectory || members.length === 0) ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Empty className="border-border bg-background/80 backdrop-blur">
            <EmptyHeader>
              <EmptyTitle>
                {!canViewDirectory
                  ? "Directory not visible"
                  : "No members to display"}
              </EmptyTitle>
              <EmptyDescription>
                {!canViewDirectory
                  ? "The member directory is not visible for this community."
                  : "This community doesn't have any orbit members yet."}
              </EmptyDescription>
            </EmptyHeader>
            <Link
              href={communityPath(handleLabel)}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted"
            >
              Back to profile
            </Link>
          </Empty>
        </div>
      ) : null}
    </>
  )
}

"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { communityPath, userPath } from "@/lib/routes"
import { sounds } from "@/lib/sounds"

import { OrbitView } from "@/components/orbit/view"
import type { OrbitMember, OrbitCommunityData } from "@/components/orbit/types"

import { OrbitSkeleton } from "@/components/orbit/orbit-skeleton"

import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"

import { useCommunity, type CommunityData } from "../community-provider"

// === HELPERS ===

function toOrbitMembers(raw: CommunityData["orbitMembers"]): OrbitMember[] {
  return raw.map((m) => ({
    id: m.id,
    handle: m.handle,
    name: m.name?.trim() || m.handle || "Unknown",
    avatarUrl: m.avatarUrl || m.image,
    headline: m.headline,
    tags: m.tags ?? [],
    orbitLevel: (m.orbitLevel as OrbitMember["orbitLevel"]) || "EXPLORER",
    loveScore: m.loveScore ?? 0,
    reachScore: m.reachScore ?? 0,
    gravityScore: m.gravityScore ?? 0,
    lastActiveAt: m.lastActiveAt,
    joinedAt: m.joinedAt,
  }))
}

function toCommunityData(
  data: CommunityData,
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
  const ctx = useCommunity()

  // Switch layout header to toolbar-only mode (animated transition)
  React.useEffect(() => {
    ctx.setHeaderMode("toolbar-only")
    return () => ctx.setHeaderMode("full")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Consume one-time drum flag set by the universe scene (read once, delete immediately)
  const fromUniverseRef = React.useRef<boolean | undefined>(undefined)
  if (fromUniverseRef.current === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    fromUniverseRef.current = !!w.__orbitPlayDrum
    delete w.__orbitPlayDrum
  }

  // Play drum directly on mount when coming from universe (no sim dependency)
  const drumPlayedRef = React.useRef(false)
  React.useEffect(() => {
    if (fromUniverseRef.current && !drumPlayedRef.current) {
      drumPlayedRef.current = true
      sounds.play("drum")
    }
  }, [])

  const handleMemberClick = React.useCallback(
    (memberIdOrHandle: string) => {
      router.push(userPath(memberIdOrHandle))
    },
    [router],
  )

  const isReady = ctx.status === "ready"
  const data = ctx.data
  const community = ctx.community
  const handleLabel = community?.handle ?? ctx.handle
  const avatarUrl = community?.avatarUrl ?? ""
  const members = data ? toOrbitMembers(data.orbitMembers) : []
  const canViewDirectory = ctx.canViewDirectory
  const communityData = data ? toCommunityData(data) : undefined
  const isOrbitLoading = ctx.status === "loading"

  return (
    <div className="fixed inset-0">
      {/* Full-screen orbit canvas */}
      {isReady && canViewDirectory && members.length > 0 ? (
        <OrbitView
          members={members}
          centerLogoUrl={avatarUrl}
          centerName={community?.name}
          isMembershipOpen={community?.isMembershipOpen ?? false}
          isPublicDirectory={community?.isPublicDirectory ?? false}
          community={communityData}
          startFromCenter
          onMemberClick={handleMemberClick}
        />
      ) : null}

      {/* Loading skeleton — only for direct navigation */}
      {isOrbitLoading ? (
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
    </div>
  )
}

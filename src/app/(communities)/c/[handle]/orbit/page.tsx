"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { communityPath, userPath } from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { communityNav, communityAdminNav } from "../nav"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { useNavigationVisibility } from "@/components/navigation/navigation-provider"
import { OrbitView } from "@/components/orbit/view"
import type { OrbitMember, OrbitCommunityData } from "@/components/orbit/types"

import { OrbitSkeleton } from "@/components/orbit/orbit-skeleton"

import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

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
  const { isVisible: navVisible } = useNavigationVisibility()

  // Hide the shared layout header — orbit has its own floating pinned header
  React.useEffect(() => {
    ctx.setHeaderHidden(true)
    return () => ctx.setHeaderHidden(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const displayName = community?.name ?? ""
  const avatarUrl = community?.avatarUrl ?? ""
  const members = data ? toOrbitMembers(data.orbitMembers) : []
  const canViewDirectory = ctx.canViewDirectory
  const communityData = data ? toCommunityData(data) : undefined
  const isOrbitLoading = ctx.status === "loading"

  return (
    <>
      {/* Page header — pinned overlay, hidden when nav is toggled off */}
      {navVisible && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-4 pt-1">
          <div className="pointer-events-auto w-full max-w-4xl">
            <PageHeader
              leading={
                avatarUrl
                  ? <ProfileAvatar
                      type="community"
                      src={avatarUrl}
                      name={displayName}
                      className="h-12 w-12"
                    />
                  : <Skeleton className="size-12 rounded-full" />
              }
              title={displayName}
              description={`@${handleLabel}`}
              sticky
              pinned
              actions={
                <PageToolbar
                  nav={communityNav(handleLabel)}
                  overflow={ctx.isAdmin ? communityAdminNav(handleLabel) : undefined}
                />
              }
              actionsAsFormActions={false}
            />
          </div>
        </div>
      )}

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
    </>
  )
}

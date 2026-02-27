"use client"

import * as React from "react"
import { useParams } from "next/navigation"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { communityNav, communityAdminNav } from "./nav"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

import { CommunityProvider, useCommunity } from "./community-provider"

// === LAYOUT ===

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

  if (!handle) return null

  return (
    <CommunityProvider handle={handle}>
      <CommunityLayoutShell>{children}</CommunityLayoutShell>
    </CommunityProvider>
  )
}

// === SHELL ===

function CommunityLayoutShell({ children }: { children: React.ReactNode }) {
  const ctx = useCommunity()

  // Not-found state
  if (ctx.status === "not-found") {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col mt-24 gap-6 pb-40">
        <Alert>
          <AlertDescription>We couldn&apos;t find @{ctx.handle}.</AlertDescription>
        </Alert>
      </div>
    )
  }

  // Error state
  if (ctx.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col mt-24 gap-6 pb-40">
        <Alert variant="destructive">
          <AlertDescription>{ctx.errorMessage}</AlertDescription>
        </Alert>
        <div>
          <Button type="button" variant="secondary" onClick={ctx.refetch}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const handleLabel = ctx.community?.handle ?? ctx.handle
  const displayName = ctx.community?.name ?? ""
  const avatarUrl = ctx.community?.avatarUrl ?? ""

  if (ctx.headerHidden) return <>{children}</>

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col mt-24 pb-40">
      <PageHeader
        leading={
          ctx.leadingOverride ?? (
            avatarUrl
              ? <ProfileAvatar type="community" src={avatarUrl} name={displayName} className="h-12 w-12" />
              : <Skeleton className="size-12 rounded-full" />
          )
        }
        title={displayName}
        description={`@${handleLabel}`}
        sticky
        actions={
          <PageToolbar
            actions={ctx.toolbarSlot?.actions}
            viewSwitch={ctx.toolbarSlot?.viewSwitch}
            nav={communityNav(handleLabel)}
            overflow={ctx.isAdmin ? communityAdminNav(handleLabel) : undefined}
          />
        }
        actionsAsFormActions={false}
      />

      <div className="flex flex-col gap-6 pt-8">
        {children}
      </div>
    </div>
  )
}

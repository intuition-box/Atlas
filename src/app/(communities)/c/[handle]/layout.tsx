"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { communityJoinPath } from "@/lib/routes"

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

// === JOIN BANNER ===

function JoinBanner({ name, handle, pending }: { name: string; handle: string; pending?: boolean }) {
  const title = pending
    ? "Your application is pending review"
    : `${name} is accepting new members`

  const description = pending
    ? "You can reopen your application to edit and update your submission while it\u2019s being reviewed."
    : "Apply to join the community and connect with other members."

  const ctaLabel = pending ? "Update application" : "Apply to join"

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-card/80 via-card/60 to-primary/5"
    >
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <div>
          <h3 className="text-base font-semibold tracking-tight">
            {title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <Button variant={pending ? "default" : "solid"} render={<Link href={communityJoinPath(handle)} />}>
          {ctaLabel}
        </Button>
      </div>
    </section>
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

  const isLoading = ctx.status === "loading"
  const handleLabel = ctx.community?.handle ?? ctx.handle
  const displayName = ctx.community?.name ?? ""
  const avatarUrl = ctx.community?.avatarUrl ?? ""
  const showJoinBanner =
    ctx.viewerMembership?.status !== "APPROVED" &&
    ctx.community?.isMembershipOpen === true

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
        description={isLoading ? "" : `@${handleLabel}`}
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
        {showJoinBanner && (
          <JoinBanner
            name={displayName}
            handle={handleLabel}
            pending={ctx.viewerMembership?.status === "PENDING"}
          />
        )}
        {children}
      </div>
    </div>
  )
}

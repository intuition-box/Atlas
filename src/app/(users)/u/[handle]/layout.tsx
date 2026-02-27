"use client"

import * as React from "react"
import { useParams } from "next/navigation"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { userNav, userPrivateNav } from "./nav"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

import { UserProvider, useUser } from "./user-provider"

// === LAYOUT ===

export default function UserLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

  if (!handle) return null

  return (
    <UserProvider handle={handle}>
      <UserLayoutShell>{children}</UserLayoutShell>
    </UserProvider>
  )
}

// === SHELL ===

function UserLayoutShell({ children }: { children: React.ReactNode }) {
  const ctx = useUser()

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
  const handleLabel = ctx.user?.handle ?? ctx.handle
  const displayName = ctx.user ? (ctx.user.name?.trim() || `@${handleLabel}`) : ""
  const avatarUrl = ctx.user?.avatarUrl || ctx.user?.image || ""

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col mt-24 pb-40">
      <PageHeader
        leading={
          ctx.leadingOverride ?? (
            avatarUrl
              ? <ProfileAvatar type="user" src={avatarUrl} name={displayName} className="h-12 w-12" />
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
            nav={userNav(handleLabel)}
            overflow={ctx.isSelf ? userPrivateNav(handleLabel) : undefined}
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

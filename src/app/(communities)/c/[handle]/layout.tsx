"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { communityJoinPath } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { AnimatePresence, motion } from "motion/react"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { communityNav, communityAdminNav } from "./nav"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { useNavigationVisibility } from "@/components/navigation/navigation-provider"
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
  const { isVisible: navVisible } = useNavigationVisibility()

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
  const isToolbarOnly = ctx.headerMode === "toolbar-only"
  const showJoinBanner =
    ctx.viewerMembership?.status !== "APPROVED" &&
    ctx.community?.isMembershipOpen === true

  // Track when the full header has finished its exit animation
  const [headerFaded, setHeaderFaded] = React.useState(false)
  React.useEffect(() => {
    if (!isToolbarOnly) setHeaderFaded(false)
  }, [isToolbarOnly])

  return (
    <div className="mx-auto flex w-full max-w-4xl mt-24 flex-col pb-40">
      {/* Full header — fades out entirely when entering orbit */}
      <AnimatePresence
        initial={false}
        onExitComplete={() => { if (isToolbarOnly) setHeaderFaded(true) }}
      >
        {!isToolbarOnly && (
          <motion.div
            key="full-header"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating toolbar — appears at top-center after header fades */}
      <AnimatePresence>
        {isToolbarOnly && headerFaded && navVisible && (
          <motion.div
            key="floating-toolbar"
            className="pointer-events-none fixed inset-x-0 top-0 z-40"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="pointer-events-auto mx-auto max-w-4xl px-4 py-3 flex justify-center">
              <PageToolbar
                nav={communityNav(handleLabel)}
                overflow={ctx.isAdmin ? communityAdminNav(handleLabel) : undefined}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn("flex flex-col gap-6", !isToolbarOnly && "pt-8")}>
        {showJoinBanner && !isToolbarOnly && (
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

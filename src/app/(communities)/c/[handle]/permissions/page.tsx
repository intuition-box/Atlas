"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import {
  ROUTES,
  communityPath,
  communityActivityPath,
  communityMembersPath,
  communityOrbitPath,
  communityApplicationsPath,
  communityBansPath,
  communityPermissionsPath,
  communitySettingsPath,
} from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// === TYPES ===

type CommunityInfo = {
  id: string
  handle: string
  name: string
  avatarUrl?: string | null
}

// === SKELETON ===

function PermissionsSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <div className="w-full p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Skeleton className="size-12 rounded-full shrink-0" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-64 rounded-4xl" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

// === MAIN COMPONENT ===

export default function CommunityPermissionsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

  const [community, setCommunity] = React.useState<CommunityInfo | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!handle) return

    const ac = new AbortController()

    void (async () => {
      const res = await apiGet<{
        community: CommunityInfo
        isAdmin: boolean
      }>("/api/community/get", { handle }, { signal: ac.signal })

      if (ac.signal.aborted) return

      if (!res.ok) {
        const parsed = parseApiError(res.error)
        if (parsed.status === 401) {
          router.replace(ROUTES.signIn)
          return
        }
        router.replace(communityPath(handle))
        return
      }

      // Gate: redirect non-admins
      if (!res.value.isAdmin) {
        router.replace(communityPath(handle))
        return
      }

      setCommunity(res.value.community)
      setLoading(false)
    })()

    return () => { ac.abort() }
  }, [handle, router])

  if (!handle) return null

  if (loading) {
    return <PermissionsSkeleton />
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar
            type="community"
            src={community?.avatarUrl}
            name={community?.name || handle}
            className="h-12 w-12"
          />
        }
        title="Permissions"
        description={`@${handle}`}
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            nav={[
              { label: "Profile", href: communityPath(handle) },
              { label: "Orbit", href: communityOrbitPath(handle) },
              { label: "Members", href: communityMembersPath(handle) },
              { label: "Activity", href: communityActivityPath(handle) },
            ]}
            overflow={[
              { label: "Applications", href: communityApplicationsPath(handle) },
              { label: "Bans", href: communityBansPath(handle) },
              { label: "Permissions", href: communityPermissionsPath(handle) },
              { label: "Settings", href: communitySettingsPath(handle) },
            ]}
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>Manage role-based permissions for this community.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
            Coming soon.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

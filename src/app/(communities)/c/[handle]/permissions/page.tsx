"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { communityPath } from "@/lib/routes"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

import { useCommunity } from "../community-provider"

// === MAIN COMPONENT ===

export default function CommunityPermissionsPage() {
  const router = useRouter()
  const ctx = useCommunity()

  // Admin gate
  React.useEffect(() => {
    if (ctx.status === "ready" && !ctx.isAdmin) {
      router.replace(communityPath(ctx.handle))
    }
  }, [ctx.status, ctx.isAdmin, ctx.handle, router])

  const isLoading = ctx.status === "loading"

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
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
  )
}

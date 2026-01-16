"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"

import { apiGet } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

import { OrbitView } from "@/components/orbit/orbit-view"

type CommunityGetResponse = {
  mode: "full" | "splash"
  community: {
    id: string
    handle: string | null
    name: string
    description: string | null
    avatarUrl: string | null
    isMembershipOpen: boolean
    membershipConfig: unknown | null
    orbitConfig: unknown | null
  }
  canViewDirectory: boolean
  isAdmin: boolean
  viewerMembership: {
    status: string
    role: string
  } | null
  orbitMembers: unknown[]
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ready"; data: CommunityGetResponse }

function initials(name: string) {
  const s = name.trim()
  if (!s) return "?"
  const parts = s.split(/\s+/g).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase()
  }
  return s.slice(0, 2).toUpperCase()
}

export default function CommunityPage() {
  const params = useParams<{ handle: string }>()
  const router = useRouter()
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
        const parsedErr = parseApiProblem(result.error)
        if (parsedErr.status === 404) {
          setState({ status: "not-found" })
          return
        }
        setState({ status: "error", message: parsedErr.formError || "Something went wrong." })
        return
      }

      const parsedErr = parseApiClientError(result.error)
      setState({ status: "error", message: parsedErr.formError || "Something went wrong." })
    })()

    return () => controller.abort()
  }, [handle])

  if (state.status === "loading" || state.status === "idle") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="flex items-start gap-4">
          <div className="bg-muted h-14 w-14 animate-pulse rounded-2xl" />
          <div className="flex-1">
            <div className="bg-muted h-6 w-64 animate-pulse rounded" />
            <div className="bg-muted mt-2 h-4 w-96 animate-pulse rounded" />
          </div>
        </div>
        <div className="bg-muted mt-8 h-[520px] w-full animate-pulse rounded-2xl" />
      </main>
    )
  }

  if (state.status === "not-found") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <h1 className="text-lg font-semibold">Community not found</h1>
        <p className="text-muted-foreground mt-1 text-sm">We couldn’t find c/{handle}.</p>
      </main>
    )
  }

  if (state.status === "error") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <h1 className="text-lg font-semibold">Couldn’t load community</h1>
        <p className="text-muted-foreground mt-1 text-sm">{state.message}</p>
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => setState({ status: "idle" })}>
            Retry
          </Button>
        </div>
      </main>
    )
  }

  const { community } = state.data
  const communityHandle = community.handle ?? handle

  const isMember = state.data.viewerMembership?.status === "APPROVED"
  const isAdmin = state.data.isAdmin

  // OrbitView expects a specific member shape.
  type OrbitMember = React.ComponentProps<typeof OrbitView>["members"][number]

  const rawMembers = (state.data.orbitMembers ?? []) as any[]

  const members: OrbitMember[] = rawMembers
    .map((m) => {
      const id = String(m?.id ?? "")
      const name = String(m?.name ?? "")

      // Prefer handle for navigation since profile route is /u/[handle].
      // If handle is missing, we fall back to id.
      const handleOrId = String(m?.handle ?? id)

      const orbitLevel = m?.orbitLevel
      const reachScore = Number(m?.reachScore ?? 0)

      return {
        // OrbitView currently navigates by `id`, so we supply handle when available.
        id: handleOrId,
        name: name || handleOrId,
        avatarUrl: (m?.avatarUrl ?? m?.image ?? null) as any,
        orbitLevel: orbitLevel as any,
        reachScore,
        headline: (m?.headline ?? null) as any,
        tags: (m?.tags ?? null) as any,
        lastActiveAt: (m?.lastActiveAt ?? null) as any,
      } as OrbitMember
    })
    // If an item is too malformed, drop it.
    .filter((m) => Boolean(m?.id) && Boolean(m?.name))

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Avatar className="size-14 rounded-2xl">
            <AvatarImage src={community.avatarUrl ?? ""} alt={community.name} />
            <AvatarFallback className="rounded-2xl">{initials(community.name)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{community.name}</h1>
            <p className="text-muted-foreground mt-1 text-sm">c/{communityHandle}</p>
            {community.description ? (
              <p className="text-muted-foreground mt-2 text-sm">{community.description}</p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {community.isMembershipOpen ? (
                <span className="rounded-full border border-border px-2 py-1 text-foreground/70">
                  Membership open
                </span>
              ) : (
                <span className="rounded-full border border-border px-2 py-1 text-foreground/70">
                  Membership closed
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isMember ? (
            <span className="rounded-full border border-border px-2 py-1 text-xs text-foreground/70">
              Member
            </span>
          ) : null}
          {isAdmin ? (
            <span className="rounded-full border border-border px-2 py-1 text-xs text-foreground/70">
              Admin
            </span>
          ) : null}
          {isAdmin ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/c/${communityHandle}/dashboard`)}
            >
              Dashboard
            </Button>
          ) : null}

          {!state.data.canViewDirectory && state.data.mode === "splash" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/c/${communityHandle}/apply`)}
            >
              Apply to join
            </Button>
          ) : null}
        </div>
      </header>

      <section className="mt-8">
        {state.data.canViewDirectory ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-foreground/80">Network</h2>
              <div className="text-xs text-foreground/60">{members.length} approved</div>
            </div>

            <OrbitView
              members={members}
              centerTitle={community.name}
              centerSubtitle={community.description?.trim() || undefined}
            />
          </div>
        ) : state.data.mode === "splash" ? (
          <div className="rounded-2xl border border-border p-6">
            <h2 className="text-base font-semibold">Members-only</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              This community is private. Apply to join to view the directory.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {community.isMembershipOpen ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => router.push(`/c/${communityHandle}/apply`)}
                >
                  Apply to join
                </Button>
              ) : null}

              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Back
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}
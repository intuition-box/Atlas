"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Check, User } from "lucide-react"
import { PlusIcon } from "@/components/ui/icons"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrbitItemDef {
  key: string
  group: "inner" | "outer"
  x: number
  y: number
  /** Avatar diameter in px */
  size: number
  rotateClassName?: string
  containerClassName?: string
  type: "user" | "trust" | "reward" | "follow" | "verified"
}

// ---------------------------------------------------------------------------
// Layout — positions, rings, sizes, decorative classes
// ---------------------------------------------------------------------------

const ITEMS: OrbitItemDef[] = [
  // Inner ring (r ~ 120)
  { key: "contributor",   group: "inner", x: -5,   y: 110,  size: 32, rotateClassName: "rotate-10",  containerClassName: "bg-green-500/20",  type: "user" },
  { key: "explorer",      group: "inner", x: -105, y: 40,   size: 24, rotateClassName: "-rotate-15", containerClassName: "bg-yellow-500/20", type: "user" },
  { key: "advocator",     group: "inner", x: 80,   y: -75,  size: 46, rotateClassName: "-rotate-0",  containerClassName: "bg-purple-500/20", type: "user" },
  { key: "verified",      group: "inner", x: -40,  y: -100, size: 32,                                containerClassName: "bg-transparent",   type: "verified" },
  // Outer ring (r ~ 215)
  { key: "trust",         group: "outer", x: -150, y: -125, size: 32, rotateClassName: "-rotate-10", containerClassName: "bg-transparent",   type: "trust" },
  { key: "participant",   group: "outer", x: -10,  y: -195, size: 28, rotateClassName: "-rotate-12", containerClassName: "bg-purple-500/20", type: "user" },
  { key: "explorer-outer", group: "outer", x: -190, y: 60,   size: 24, rotateClassName: "-rotate-15", containerClassName: "bg-yellow-500/20", type: "user" },
  { key: "follow",        group: "outer", x: 195,  y: -10,  size: 32, rotateClassName: "-rotate-6",  containerClassName: "bg-transparent",   type: "follow" },
  { key: "reward",        group: "outer", x: 95,   y: 170,  size: 32,                                containerClassName: "bg-transparent",   type: "reward" },
]

/**
 * Item keys that consume an avatar from the general pool.
 * Order here = allocation order — each key gets a unique index.
 * The "reward" item uses a dedicated `newestMemberUrl` prop instead.
 */
const POOL_KEYS = ITEMS
  .filter((i) => i.type === "user")
  .map((i) => i.key)

const INNER_ITEMS = ITEMS.filter((i) => i.group === "inner")
const OUTER_ITEMS = ITEMS.filter((i) => i.group === "outer")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------------------------------------------------------------------------
// OrbitAvatar — single avatar with fade-in
// ---------------------------------------------------------------------------

function OrbitAvatar({
  url,
  size = 32,
  loadKey,
  loaded,
  onLoad,
}: {
  url?: string
  size?: number
  loadKey: string
  loaded: boolean
  onLoad: (key: string) => void
}) {
  return (
    <Avatar className="after:hidden" style={{ height: size, width: size }}>
      {url ? (
        <AvatarImage
          src={url}
          alt=""
          className={cn(
            "transition-opacity duration-700",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => onLoad(loadKey)}
          onError={() => onLoad(loadKey)}
        />
      ) : null}
      <AvatarFallback className="bg-muted/60">
        <User className="size-4 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function OrbitAnimation({
  className,
  avatarUrls,
  attestationPair,
  followPair,
  newestMemberUrl,
  verifiedMemberUrl,
}: {
  className?: string
  avatarUrls?: string[]
  /** [fromAvatarUrl, toAvatarUrl] from a real attestation */
  attestationPair?: [string, string]
  /** [fromAvatarUrl, toAvatarUrl] for the follow item — must not overlap attestationPair */
  followPair?: [string, string]
  /** Avatar URL of the most recently created user — shown next to the + icon */
  newestMemberUrl?: string
  /** Avatar URL of a recently onboarded user — shown next to the ✅ icon */
  verifiedMemberUrl?: string
}) {
  const [mounted, setMounted] = React.useState(false)
  const [pool, setPool] = React.useState<string[]>([])
  const [loaded, setLoaded] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Build the general avatar pool — deduplicated, attestation/follow pairs excluded.
  // Each pool index maps to exactly one unique URL.
  React.useEffect(() => {
    const reserved = new Set([
      ...(attestationPair ?? []),
      ...(followPair ?? []),
      ...(newestMemberUrl ? [newestMemberUrl] : []),
      ...(verifiedMemberUrl ? [verifiedMemberUrl] : []),
    ])
    const unique = Array.from(
      new Set(
        (avatarUrls ?? [])
          .map((u) => (typeof u === "string" ? u.trim() : ""))
          .filter(Boolean),
      ),
    ).filter((u) => !reserved.has(u))

    setLoaded({})
    setPool(shuffle(unique))
  }, [avatarUrls, attestationPair, followPair, newestMemberUrl, verifiedMemberUrl])

  // Map each pool-consuming item key -> unique avatar URL (or undefined)
  const poolMap = React.useMemo(() => {
    const map = new Map<string, string | undefined>()
    POOL_KEYS.forEach((key, i) => {
      map.set(key, i < pool.length ? pool[i] : undefined)
    })
    return map
  }, [pool])

  const markLoaded = React.useCallback((key: string) => {
    setLoaded((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
  }, [])

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  function renderItemContent(item: OrbitItemDef) {
    if (item.type === "trust") {
      return (
        <div className="flex items-center gap-1.5">
          <OrbitAvatar url={attestationPair?.[0]} size={item.size} loadKey="attestation:from" loaded={!!loaded["attestation:from"]} onLoad={markLoaded} />
          <span>🤝</span>
          <OrbitAvatar url={attestationPair?.[1]} size={item.size} loadKey="attestation:to" loaded={!!loaded["attestation:to"]} onLoad={markLoaded} />
        </div>
      )
    }

    if (item.type === "follow") {
      return (
        <div className="flex items-center gap-1.5">
          <OrbitAvatar url={followPair?.[0]} size={item.size} loadKey="follow:from" loaded={!!loaded["follow:from"]} onLoad={markLoaded} />
          <span>👀</span>
          <OrbitAvatar url={followPair?.[1]} size={item.size} loadKey="follow:to" loaded={!!loaded["follow:to"]} onLoad={markLoaded} />
        </div>
      )
    }

    if (item.type === "verified") {
      return (
        <div className="flex items-center gap-1">
          <Check className="size-4 text-emerald-500" />
          <OrbitAvatar url={verifiedMemberUrl} size={item.size} loadKey="verified-member" loaded={!!loaded["verified-member"]} onLoad={markLoaded} />
        </div>
      )
    }

    if (item.type === "reward") {
      return (
        <div className="flex items-center gap-1">
          <PlusIcon className="h-4 text-sm font-semibold text-primary" />
          <OrbitAvatar url={newestMemberUrl} size={item.size} loadKey="newest-member" loaded={!!loaded["newest-member"]} onLoad={markLoaded} />
        </div>
      )
    }

    // type === "user"
    const url = poolMap.get(item.key)
    const k = `pool:${item.key}`
    return <OrbitAvatar url={url} size={item.size} loadKey={k} loaded={!!loaded[k]} onLoad={markLoaded} />
  }

  function renderRing(
    items: OrbitItemDef[],
    spinClass: string,
    counterSpinClass: string,
  ) {
    return (
      <div
        className={cn(
          "absolute inset-0 origin-center will-change-transform",
          mounted ? spinClass : "",
        )}
      >
        {items.map((item) => (
          <div
            key={item.key}
            className="absolute left-1/2 top-1/2 flex items-center justify-center will-change-transform"
            style={{
              transform: `translate3d(-50%, -50%, 0) translate3d(${item.x}px, ${item.y}px, 0) scale(0.98)`,
            }}
          >
            <div
              className={cn(
                "flex items-center justify-center rounded-full backdrop-blur-sm will-change-transform",
                item.containerClassName,
                counterSpinClass,
                item.rotateClassName,
              )}
            >
              {renderItemContent(item)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className={cn("overflow-visible relative flex w-full aspect-square items-center justify-center", className)}>
      <svg className="absolute w-full h-full" aria-hidden="true" viewBox="0 0 500 500">
        <defs>
          <linearGradient x1="0.1" x2="0.9" y1="0.1" y2="0.9" id="grad">
            <stop stopColor="#999" stopOpacity="0" />
            <stop offset="0.5" stopColor="#555" />
            <stop offset="1" stopColor="#999" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle
          cx="250"
          cy="250"
          fill="none"
          r="120"
          stroke="url(#grad)"
          strokeOpacity="0.2"
          strokeWidth="1"
          className={mounted ? "origin-center animate-[spin_80s_linear_infinite] will-change-transform" : ""}
        />
        <circle
          cx="250"
          cy="250"
          fill="none"
          r="215"
          stroke="url(#grad)"
          strokeOpacity="0.2"
          strokeWidth="1"
          className={mounted ? "origin-center animate-[spin_110s_linear_infinite_reverse] will-change-transform" : ""}
        />
      </svg>

      {renderRing(INNER_ITEMS, "animate-[spin_80s_linear_infinite]", "animate-[spin_80s_linear_infinite_reverse]")}
      {renderRing(OUTER_ITEMS, "animate-[spin_110s_linear_infinite]", "animate-[spin_110s_linear_infinite_reverse]")}
    </div>
  )
}

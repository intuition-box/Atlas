"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { User } from "lucide-react"
import { PlusIcon } from "@/components/ui/icons"

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

type OrbitGroup = "inner" | "outer"

type OrbitItemDef = {
  key: string
  group: OrbitGroup
  x: number
  y: number
  rotateClassName?: string
  containerClassName?: string
  type: "user" | "community" | "reward"
  avatarIndex?: number
}

const ORBIT_ITEM_BASE = "rounded-full bg-background/30 p-1"

const ORBIT_ITEMS: OrbitItemDef[] = [
  // INNER RING (r ≈ 120)
  {
    key: "contributor",
    group: "inner",
    x: -5,
    y: 110,
    rotateClassName: "rotate-10",
    containerClassName: "bg-green-500/20",
    type: "user",
    avatarIndex: 0,
  },
  {
    key: "explorer",
    group: "inner",
    x: -105,
    y: 40,
    rotateClassName: "-rotate-15",
    containerClassName: "bg-yellow-500/20",
    type: "user",
    avatarIndex: 1,
  },
  {
    key: "advocator",
    group: "inner",
    x: 80,
    y: -75,
    rotateClassName: "-rotate-0",
    containerClassName: "bg-purple-500/20",
    type: "user",
    avatarIndex: 2,
  },
  {
    key: "contributor",
    group: "inner",
    x: -40,
    y: -100,
    containerClassName: "bg-green-500/20",
    type: "user",
    avatarIndex: 3,
  },

  // OUTER RING (r ≈ 215)
  {
    key: "participant",
    group: "outer",

    x: -150,
    y: -125,
    containerClassName: "bg-transparent",
    rotateClassName: "-rotate-10",
    type: "community",
    avatarIndex: 5,
  },
  {
    key: "participant",
    group: "outer",
    x: -10,
    y: -195,
    rotateClassName: "-rotate-12",
    containerClassName: "bg-purple-500/20",
    type: "user",
    avatarIndex: 6,
  },
  {
    key: "explorer",
    group: "outer",
    x: -190,
    y: 60,
    rotateClassName: "-rotate-15",
    containerClassName: "bg-yellow-500/20",
    type: "user",
    avatarIndex: 7,
  },
  {
    key: "explorer",
    group: "outer",
    x: 195,
    y: -10,
    rotateClassName: "-rotate-6",
    containerClassName: "bg-yellow-500/20",
    type: "user",
    avatarIndex: 8,
  },
  {
    key: "participant",
    group: "outer",
    x: 95,
    y: 170,
    containerClassName: "bg-transparent",
    type: "reward",
  },
]

export default function OrbitAnimation({
  className,
  avatarUrls,
}: {
  className?: string
  avatarUrls?: string[]
}) {
  const [mounted, setMounted] = React.useState(false)
  const [avatars, setAvatars] = React.useState<string[]>([])
  const [avatarSeed, setAvatarSeed] = React.useState(() => Math.floor(Math.random() * 10_000))
  const [loaded, setLoaded] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    const urls = (avatarUrls ?? [])
      .map((u) => (typeof u === "string" ? u.trim() : ""))
      .filter(Boolean)

    const unique = Array.from(new Set(urls)).slice(0, 24)
    setLoaded({})
    setAvatars(shuffle(unique))
    setAvatarSeed(Math.floor(Math.random() * 10_000))
  }, [avatarUrls])

  const getAvatarUrl = React.useCallback(
    (index: number) => {
      if (!avatars.length) return undefined
      const i = (index + avatarSeed) % avatars.length
      return avatars[i]
    },
    [avatars, avatarSeed],
  )

  const markLoaded = React.useCallback((key: string) => {
    setLoaded((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
  }, [])

  function AvatarToken({ index, size = 32 }: { index: number; size?: number }) {
    const url = getAvatarUrl(index)
    const loadKey = `${index}:${url ?? ""}`
    const isLoaded = !!loaded[loadKey]

    return (
      <Avatar
        className="after:border-none"
        style={{ height: size, width: size }}
      >
        <AvatarImage
          src={url ?? undefined}
          alt=""
          className={cn("transition-opacity duration-700", url && isLoaded ? "opacity-100" : "opacity-0")}
          onLoad={() => markLoaded(loadKey)}
          onError={() => markLoaded(loadKey)}
        />
        <AvatarFallback className="bg-transparent">
          <User className="size-4 text-muted-foreground" />
        </AvatarFallback>
      </Avatar>
    )
  }

  const innerItems = React.useMemo(() => ORBIT_ITEMS.filter((i) => i.group === "inner"), [])
  const outerItems = React.useMemo(() => ORBIT_ITEMS.filter((i) => i.group === "outer"), [])

  const renderItem = React.useCallback(
    (item: OrbitItemDef) => {
      if (item.type === "user") {
        const idx = item.avatarIndex ?? 0
        const size =
          item.key === "explorer"
            ? 24
            : item.key === "participant"
              ? 28
              : item.key === "contributor"
                ? 32
                : item.key === "advocator"
                  ? 46
                  : 24

        return <AvatarToken index={idx} size={size} />
      }

      if (item.type === "community") {
        return (
          <div className="flex items-center gap-1.5">
            <div className="rounded-full bg-slate-800/20 p-1">
              <AvatarToken index={4} />
            </div>
            <span>🤝</span>
            <div className="rounded-full bg-amber-900/20 p-1">
              <AvatarToken index={5} />
            </div>
          </div>
        )
      }

      return (
        <div className="flex items-center p-1">
          <PlusIcon className="h-4 text-sm font-semibold text-blue-400" />
          <AvatarToken index={9} />
        </div>
      )
    },
    [loaded, getAvatarUrl, markLoaded],
  )

  const renderOrbitingItems = React.useCallback(
    (itemsList: OrbitItemDef[], animationClass: string, counterRotateClass: string) => {
      return (
        <div
          className={cn(
            "absolute inset-0 origin-center will-change-transform",
            mounted ? animationClass : "",
          )}
        >
          {itemsList.map((item) => (
            <div
              key={`${item.group}:${item.key}:${item.x}:${item.y}`}
              className="absolute left-1/2 top-1/2 flex items-center justify-center will-change-transform"
              style={{
                transform: `translate3d(-50%, -50%, 0) translate3d(${item.x}px, ${item.y}px, 0) scale(0.98)`,
              }}
            >
              <div
                className={cn(
                  "flex items-center justify-center backdrop-blur-sm will-change-transform",
                  ORBIT_ITEM_BASE,
                  item.containerClassName,
                  counterRotateClass,
                  item.rotateClassName,
                )}
              >
                {renderItem(item)}
              </div>
            </div>
          ))}
        </div>
      )
    },
    [mounted, renderItem],
  )

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

      {renderOrbitingItems(innerItems, "animate-[spin_80s_linear_infinite]", "animate-[spin_80s_linear_infinite_reverse]")}

      {renderOrbitingItems(outerItems, "animate-[spin_110s_linear_infinite]", "animate-[spin_110s_linear_infinite_reverse]")}
    </div>
  )
}
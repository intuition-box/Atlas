"use client"

import * as React from "react"
import { useSession } from "next-auth/react"
import { Mail, UserPlus } from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet, apiPost } from "@/lib/api/client"
import { formatRelativeTime } from "@/lib/format"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

import { useCommunity, type InvitationItem } from "../community-provider"

type UserSearchItem = {
  id: string
  handle: string | null
  name: string | null
  avatarUrl: string | null
  isMember?: boolean
}

/* ────────────────────────────
   Page
──────────────────────────── */

export default function InvitesPage() {
  const { data: session } = useSession()
  const { community } = useCommunity()

  const { invitations, setInvitations, invitationsLoaded } = useCommunity()
  const [query, setQuery] = React.useState("")
  const [searchResults, setSearchResults] = React.useState<UserSearchItem[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const [staged, setStaged] = React.useState<UserSearchItem[]>([])
  const [isSending, setIsSending] = React.useState(false)
  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(null)

  React.useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    searchTimeoutRef.current = setTimeout(async () => {
      const result = await apiGet<{ users: UserSearchItem[] }>(
        "/api/user/search",
        { q: query.trim(), take: 8, communityId: community?.id },
      )
      if (result.ok) setSearchResults(result.value.users)
      setIsSearching(false)
    }, 300)
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current) }
  }, [query, community?.id])

  const stagedIds = new Set(staged.map((s) => s.id))
  const invitedIds = new Set(invitations.map((i) => i.invitedUser.id))
  const showDropdown = query.trim().length >= 2 && (searchResults.length > 0 || isSearching)

  const handleSendInvites = async () => {
    if (!community?.id || isSending || staged.length === 0) return
    setIsSending(true)
    for (const user of staged) {
      const result = await apiPost<{ invitation: { id: string; status: string } }>(
        "/api/invitation/send",
        { communityId: community.id, userId: user.id },
      )
      if (result.ok) {
        setInvitations((prev) => [{
          id: result.value.invitation.id,
          status: "PENDING",
          message: null,
          createdAt: new Date().toISOString(),
          acceptedAt: null,
          declinedAt: null,
          invitedUser: user,
          invitedByUser: {
            id: session?.user?.id ?? "",
            handle: session?.user?.handle ?? null,
            name: session?.user?.name ?? null,
            avatarUrl: session?.user?.image ?? null,
          },
        }, ...prev])
      }
    }
    setStaged([])
    setIsSending(false)
  }

  if (!community) return null

  const pending = invitations.filter((i) => i.status === "PENDING")
  const accepted = invitations.filter((i) => i.status === "ACCEPTED")
  const declined = invitations.filter((i) => i.status === "DECLINED")

  return (
    <div className="flex flex-col gap-6 pb-20">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="size-4" />
            Invitations
          </CardTitle>
          <CardDescription>Invite Atlas users to join {community.name}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Search */}
          <div className="relative">
            <Input
              placeholder="Search by name or handle…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {showDropdown && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-2xl border border-border/60 bg-popover p-1 shadow-2xl ring-1 ring-foreground/5 max-h-64 overflow-y-auto">
                {isSearching && searchResults.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground text-center">Searching…</div>
                ) : (
                  searchResults.map((user) => {
                    const isStaged = stagedIds.has(user.id)
                    const isInvited = invitedIds.has(user.id)
                    const disabled = user.isMember || isStaged || isInvited
                    return (
                      <button
                        key={user.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors text-left",
                          disabled ? "opacity-50 cursor-default" : "hover:bg-accent/10",
                        )}
                        onClick={() => {
                          if (disabled) return
                          setStaged((prev) => [...prev, user])
                          setQuery("")
                          setSearchResults([])
                        }}
                        disabled={disabled}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ProfileAvatar type="user" src={user.avatarUrl} name={user.name || "User"} size="sm" />
                          <span className="font-medium truncate">{user.name || "Unnamed"}</span>
                          {user.handle && <span className="text-muted-foreground truncate">@{user.handle}</span>}
                        </div>
                        <Badge variant={user.isMember ? "positive" : "secondary"} className="text-[10px] shrink-0">
                          {user.isMember ? "Member" : isStaged ? "Selected" : isInvited ? "Invited" : "Select"}
                        </Badge>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* Staged pills + invite button */}
          {staged.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {staged.map((user) => (
                  <span key={user.id} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium">
                    <ProfileAvatar type="user" src={user.avatarUrl} name={user.name || "User"} size="sm" />
                    {user.handle ? `@${user.handle}` : user.name || "User"}
                    <button type="button" className="ml-0.5 text-destructive hover:text-destructive/80" onClick={() => setStaged((prev) => prev.filter((u) => u.id !== user.id))}>×</button>
                  </span>
                ))}
              </div>
              <Button onClick={handleSendInvites} disabled={isSending} className="self-end">
                {isSending ? "Sending…" : `Invite ${staged.length} user${staged.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          )}

          {/* Invitation list */}
          {!invitationsLoaded ? null : invitations.length === 0 && staged.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Mail className="size-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No invitations sent yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Search for users above to invite them</p>
            </div>
          ) : invitations.length > 0 ? (
            <div className="flex flex-col gap-4">
              {pending.length > 0 && <InvitationSection title="Pending" items={pending} onRevoke={(id) => setInvitations((prev) => prev.filter((i) => i.id !== id))} />}
              {accepted.length > 0 && <InvitationSection title="Accepted" items={accepted} />}
              {declined.length > 0 && <InvitationSection title="Declined" items={declined} />}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function InvitationSection({ title, items, onRevoke }: { title: string; items: InvitationItem[]; onRevoke?: (id: string) => void }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">{title} ({items.length})</h3>
      <div className="flex flex-col gap-1">
        {items.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-center gap-2 min-w-0">
              <ProfileAvatar type="user" src={inv.invitedUser.avatarUrl} name={inv.invitedUser.name || "User"} size="sm" />
              <div className="min-w-0">
                <span className="text-sm font-medium">{inv.invitedUser.name || "Unnamed"}</span>
                {inv.invitedUser.handle && <span className="text-xs text-muted-foreground ml-1">@{inv.invitedUser.handle}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={inv.status === "ACCEPTED" ? "positive" : inv.status === "DECLINED" ? "destructive" : "secondary"}>
                {inv.status === "PENDING" ? "Pending" : inv.status === "ACCEPTED" ? "Accepted" : "Declined"}
              </Badge>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(inv.createdAt)}</span>
              {onRevoke && inv.status === "PENDING" && (
                <Button variant="ghost" size="xs" className="text-destructive" onClick={() => onRevoke(inv.id)}>
                  Revoke
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

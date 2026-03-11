"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { apiPost } from "@/lib/api/client"
import { cn } from "@/lib/utils"
import { parseApiError } from "@/lib/api/errors"
import {
  CONFIGURABLE_ROLES,
  DEFAULT_PERMISSIONS,
  PERMISSION_LABELS,
  PermissionKeySchema,
  RolePermissionsSchema,
  hasPermission,
  type ConfigurableRole,
  type PermissionKey,
  type RolePermissions,
} from "@/lib/permissions-shared"
import { communityPath } from "@/lib/routes"

import { UnsavedChangesBar } from "@/components/common/unsaved-changes-bar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"

import { useCommunity } from "../community-provider"

// ─── Constants ────────────────────────────────────────────────────────────────

const PERMISSION_KEYS = PermissionKeySchema.options as readonly PermissionKey[]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse raw JSON into RolePermissions, falling back to defaults. */
function parsePermissions(raw: unknown): RolePermissions {
  const parsed = RolePermissionsSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_PERMISSIONS
}

/** Deep-equal check for two RolePermissions objects. */
function permissionsEqual(a: RolePermissions, b: RolePermissions): boolean {
  for (const role of CONFIGURABLE_ROLES) {
    const aPerms = [...a[role]].sort()
    const bPerms = [...b[role]].sort()
    if (aPerms.length !== bPerms.length) return false
    for (let i = 0; i < aPerms.length; i++) {
      if (aPerms[i] !== bPerms[i]) return false
    }
  }
  return true
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function CommunityPermissionsPage() {
  const router = useRouter()
  const ctx = useCommunity()

  // Permission gate — redirect users without community.permissions permission
  const canManagePermissions = hasPermission(
    ctx.viewerMembership?.role ?? "MEMBER",
    "community.permissions",
    ctx.community?.permissions,
  )

  React.useEffect(() => {
    if (ctx.status === "ready" && !canManagePermissions) {
      router.replace(communityPath(ctx.handle))
    }
  }, [ctx.status, canManagePermissions, ctx.handle, router])

  // Parse initial permissions from community data
  const savedPermissions = React.useMemo(
    () => parsePermissions(ctx.community?.permissions),
    [ctx.community?.permissions],
  )

  // Local draft state
  const [draft, setDraft] = React.useState<RolePermissions>(savedPermissions)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Sync draft when server data changes (e.g., after refetch)
  React.useEffect(() => {
    setDraft(savedPermissions)
  }, [savedPermissions])

  const isDirty = !permissionsEqual(draft, savedPermissions)

  function togglePermission(role: ConfigurableRole, permission: PermissionKey) {
    setDraft((prev) => {
      const rolePerms = prev[role]
      const has = rolePerms.includes(permission)
      return {
        ...prev,
        [role]: has
          ? rolePerms.filter((p) => p !== permission)
          : [...rolePerms, permission],
      }
    })
  }

  async function handleSave() {
    if (!ctx.community?.id) return

    setSaving(true)
    setError(null)

    const result = await apiPost<{ permissions: unknown }>(
      "/api/community/permissions/update",
      {
        communityId: ctx.community.id,
        permissions: draft,
      },
    )

    setSaving(false)

    if (result.ok) {
      ctx.refetch()
      return
    }

    const parsed = parseApiError(result.error)
    setError(parsed.formError || "Failed to save permissions. Please try again.")
  }

  function handleReset() {
    setDraft(savedPermissions)
    setError(null)
  }

  const viewerRole = ctx.viewerMembership?.role ?? "MEMBER"
  const isOwner = viewerRole === "OWNER"

  // Loading state
  if (ctx.status === "loading") {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>
            Control what each role can do in this community. Owners always have full access.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Desktop: table layout */}
          <div className="hidden sm:block">
            <PermissionsTable
              draft={draft}
              onToggle={togglePermission}
              isOwner={isOwner}
            />
          </div>

          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-4 sm:hidden">
            <PermissionsCards
              draft={draft}
              onToggle={togglePermission}
              isOwner={isOwner}
            />
          </div>
        </CardContent>
      </Card>

      <UnsavedChangesBar
        show={isDirty}
        saving={saving}
        onSave={handleSave}
        onReset={handleReset}
      />
    </>
  )
}

// ─── Desktop table ────────────────────────────────────────────────────────────

/** All role columns displayed in the table. */
const TABLE_ROLES = ["OWNER", ...CONFIGURABLE_ROLES] as const
const ROLE_DISPLAY: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MODERATOR: "Moderator",
}

function PermissionsTable({
  draft,
  onToggle,
  isOwner,
}: {
  draft: RolePermissions
  onToggle: (role: ConfigurableRole, permission: PermissionKey) => void
  isOwner: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/30">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Permission
            </th>
            {TABLE_ROLES.map((role) => {
              const isDisabledCol = role === "OWNER" || (!isOwner && role === "ADMIN")
              return (
                <th
                  key={role}
                  className={cn(
                    "px-4 py-3 text-center font-medium text-muted-foreground",
                    isDisabledCol && "opacity-40",
                  )}
                >
                  {ROLE_DISPLAY[role]}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_KEYS.map((permission, i) => {
            const { label, description } = PERMISSION_LABELS[permission]
            const isLast = i === PERMISSION_KEYS.length - 1

            return (
              <tr
                key={permission}
                className={isLast ? "" : "border-b border-border/40"}
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">
                      {description}
                    </span>
                  </div>
                </td>
                {TABLE_ROLES.map((role) => {
                  const isOwnerCol = role === "OWNER"
                  const isAdminCol = role === "ADMIN"
                  const isDisabled = isOwnerCol || (!isOwner && isAdminCol)
                  const checked = isOwnerCol
                    ? true
                    : draft[role as ConfigurableRole].includes(permission)
                  const id = `${role}-${permission}`

                  return (
                    <td
                      key={role}
                      className={cn(
                        "px-4 py-3 text-center",
                        isDisabled && "opacity-40",
                      )}
                    >
                      <div className="flex items-center justify-center">
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={isDisabled}
                          onCheckedChange={
                            isDisabled
                              ? undefined
                              : () => onToggle(role as ConfigurableRole, permission)
                          }
                          aria-label={`${ROLE_DISPLAY[role]} can ${label.toLowerCase()}`}
                        />
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Mobile cards ─────────────────────────────────────────────────────────────

function PermissionsCards({
  draft,
  onToggle,
  isOwner,
}: {
  draft: RolePermissions
  onToggle: (role: ConfigurableRole, permission: PermissionKey) => void
  isOwner: boolean
}) {
  return (
    <>
      {PERMISSION_KEYS.map((permission) => {
        const { label, description } = PERMISSION_LABELS[permission]

        return (
          <div
            key={permission}
            className="rounded-lg border border-border/60 p-4"
          >
            <div className="mb-3 flex flex-col gap-0.5">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </div>

            <div className="flex flex-col gap-2">
              {/* Owner row (always enabled, disabled) */}
              <label className="flex items-center gap-2 text-sm opacity-40">
                <Checkbox
                  checked={true}
                  disabled
                />
                <span>Owner</span>
              </label>

              {CONFIGURABLE_ROLES.map((role) => {
                const isDisabled = !isOwner && role === "ADMIN"
                const checked = draft[role].includes(permission)
                const id = `mobile-${role}-${permission}`

                return (
                  <label
                    key={role}
                    htmlFor={isDisabled ? undefined : id}
                    className={cn(
                      "flex items-center gap-2 text-sm",
                      isDisabled ? "opacity-40" : "cursor-pointer",
                    )}
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      disabled={isDisabled}
                      onCheckedChange={
                        isDisabled
                          ? undefined
                          : () => onToggle(role, permission)
                      }
                    />
                    <span>{ROLE_DISPLAY[role]}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

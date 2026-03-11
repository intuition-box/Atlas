/**
 * Permission schemas, constants, and helpers shared between client and server.
 *
 * This file intentionally has NO "server-only" import so it can be used in
 * client components (e.g., the permissions page checkbox matrix).
 */

import { z } from "zod";

// ─── Permission schemas ──────────────────────────────────────────────────────

/** Every toggleable permission in the system. */
export const PermissionKeySchema = z.enum([
  "community.update",       // Edit community settings (name, description, avatar, links)
  "community.permissions",  // View and manage role permissions
  "membership.review",      // Approve/reject/ban applications
  "membership.role",        // Change member roles (except OWNER)
  "membership.orbit",       // Override orbit levels
  "membership.remove",      // Remove/ban members
]);
export type PermissionKey = z.infer<typeof PermissionKeySchema>;

/** Per-role permission arrays stored as Community.permissions JSON. */
export const RolePermissionsSchema = z.object({
  ADMIN: z.array(PermissionKeySchema),
  MODERATOR: z.array(PermissionKeySchema),
});
export type RolePermissions = z.infer<typeof RolePermissionsSchema>;

/** Configurable roles (OWNER always has all, MEMBER never has any). */
export type ConfigurableRole = "ADMIN" | "MODERATOR";

export const CONFIGURABLE_ROLES: ConfigurableRole[] = ["ADMIN", "MODERATOR"];

/** Sensible defaults when Community.permissions is null. */
export const DEFAULT_PERMISSIONS: RolePermissions = {
  ADMIN: [
    "community.update",
    "community.permissions",
    "membership.review",
    "membership.role",
    "membership.orbit",
    "membership.remove",
  ],
  MODERATOR: [
    "membership.review",
  ],
};

/** Human-readable labels for the permissions page UI. */
export const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  "community.update":      { label: "Edit settings",        description: "Change community name, description, avatar, and links" },
  "community.permissions": { label: "Manage permissions",   description: "View and edit role permission settings" },
  "membership.review":     { label: "Review applications",  description: "Approve, reject, or ban membership applications" },
  "membership.role":       { label: "Manage roles",         description: "Promote or demote members (except owners)" },
  "membership.orbit":      { label: "Override orbits",      description: "Manually override a member's orbit level" },
  "membership.remove":     { label: "Remove members",       description: "Remove or ban existing members" },
};

/**
 * Check whether a role has a specific permission in a community.
 *
 * - OWNER always has all permissions.
 * - MEMBER never has admin permissions.
 * - ADMIN/MODERATOR are checked against the community's permissions JSON
 *   (falls back to DEFAULT_PERMISSIONS when null or invalid).
 */
export function hasPermission(
  role: string,
  permission: PermissionKey,
  communityPermissions: unknown,
): boolean {
  if (role === "OWNER") return true;
  if (role === "MEMBER") return false;

  const parsed = RolePermissionsSchema.safeParse(communityPermissions);
  const perms = parsed.success ? parsed.data : DEFAULT_PERMISSIONS;
  const rolePerms = perms[role as ConfigurableRole] ?? [];
  return rolePerms.includes(permission);
}

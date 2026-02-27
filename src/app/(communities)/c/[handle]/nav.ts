import {
  Activity,
  Ban,
  FileText,
  Info,
  Orbit,
  Settings,
  Shield,
  Users,
} from "lucide-react";

import type { NavItem } from "@/components/common/page-toolbar";
import {
  communityActivityPath,
  communityApplicationsPath,
  communityBansPath,
  communityMembersPath,
  communityOrbitPath,
  communityPath,
  communityPermissionsPath,
  communitySettingsPath,
} from "@/lib/routes";

/** Public navigation tabs (visible to all visitors). */
export function communityNav(handle: string): NavItem[] {
  return [
    { label: "Profile", href: communityPath(handle), icon: Info },
    { label: "Orbit", href: communityOrbitPath(handle), icon: Orbit },
    { label: "Members", href: communityMembersPath(handle), icon: Users },
    { label: "Activity", href: communityActivityPath(handle), icon: Activity },
  ];
}

/** Admin navigation tabs (visible to community admins only). */
export function communityAdminNav(handle: string): NavItem[] {
  return [
    { label: "Applications", href: communityApplicationsPath(handle), icon: FileText, activeColor: "text-amber-500", activeBg: "bg-amber-500/10" },
    { label: "Bans", href: communityBansPath(handle), icon: Ban, activeColor: "text-amber-500", activeBg: "bg-amber-500/10" },
    { label: "Permissions", href: communityPermissionsPath(handle), icon: Shield, activeColor: "text-amber-500", activeBg: "bg-amber-500/10" },
    { label: "Settings", href: communitySettingsPath(handle), icon: Settings, activeColor: "text-amber-500", activeBg: "bg-amber-500/10" },
  ];
}

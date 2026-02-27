import {
  Activity,
  Award,
  Info,
  Settings,
} from "lucide-react";

import type { NavItem } from "@/components/common/page-toolbar";
import {
  userActivityPath,
  userAttestationsPath,
  userPath,
  userSettingsPath,
} from "@/lib/routes";

/** Public navigation tabs (visible to all visitors). */
export function userNav(handle: string): NavItem[] {
  return [
    { label: "Profile", href: userPath(handle), icon: Info },
    { label: "Attestations", href: userAttestationsPath(handle), icon: Award },
    { label: "Activity", href: userActivityPath(handle), icon: Activity },
  ];
}

/** Private navigation tab (visible only to the profile owner). */
export function userPrivateNav(handle: string): NavItem[] {
  return [
    { label: "Settings", href: userSettingsPath(handle), icon: Settings, activeColor: "text-amber-500", activeBg: "bg-amber-500/10" },
  ];
}

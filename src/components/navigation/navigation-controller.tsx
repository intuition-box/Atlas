"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  ChevronDown,
  Eye,
  EyeOff,
  Globe,
  LogIn,
  LogOut,
  Plus,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useSounds } from "@/lib/sounds";
import { ROUTES, userPath, userSettingsPath, activityPath } from "@/lib/routes";
import { Logo } from "@/components/brand/logo";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { NavigationButton } from "./navigation-button";
import {
  useNavigationContext,
  useNavigationVisibility,
} from "./navigation-provider";
import { AttestationQueueButton } from "@/components/attestation/queue-button";
import { AttestationQueuePanel } from "@/components/attestation/queue-panel";

/* ────────────────────────────
   Types
──────────────────────────── */

type NavigationControllerProps = {
  className?: string;
};

/* ────────────────────────────
   Component
──────────────────────────── */

export function NavigationController({
  className,
}: NavigationControllerProps) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { controls, isVisible } = useNavigationContext();
  const { toggle } = useNavigationVisibility();
  const { isEnabled: isSoundEnabled, toggle: toggleSound } = useSounds();

  const isAuthed = status === "authenticated" && !!session?.user;
  const isSignInPage = pathname === ROUTES.signIn;

  // Hide all navigation on the sign-in page
  if (isSignInPage) return null;

  const userHandle = session?.user?.handle;
  const settingsHref = userHandle ? userSettingsPath(userHandle) : null;

  // Don't render anything if visibility is off (except the eye toggle)
  const showControls = isVisible;

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 pointer-events-none",
        "p-4 sm:p-6",
        className
      )}
    >
      {/* Top Left - Logo + Global Menu */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute top-4 left-4 sm:top-6 sm:left-6 pointer-events-auto"
          >
            <Menu>
              <MenuTrigger
                className={cn(
                  "flex items-center gap-1",
                  "pl-1 pr-0.5 py-1 rounded-full",
                  "hover:text-foreground/80",
                  "transition-all duration-200",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                )}
              >
                <Logo className="size-4.5" />
                <span className="text-xl font-semibold text-foreground">Atlas</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </MenuTrigger>
              <MenuContent side="bottom" align="start" sideOffset={8}>
                <MenuItem render={<Link href={ROUTES.home} />}>
                  <Globe className="size-4" />
                  Communities
                </MenuItem>
                <MenuItem render={<Link href={activityPath()} />}>
                  <Activity className="size-4" />
                  Activity
                </MenuItem>
                {isAuthed && userHandle && (
                  <MenuItem render={<Link href={userPath(userHandle)} />}>
                    <User className="size-4" />
                    Profile
                  </MenuItem>
                )}
                {isAuthed ? (
                  <>
                    <MenuSeparator />
                    <MenuItem render={<Link href={ROUTES.newCommunity} />}>
                      <Plus className="size-4" />
                      New Community
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem variant="destructive" onClick={() => signOut({ callbackUrl: "/" })}>
                      <LogOut className="size-4" />
                      Logout
                    </MenuItem>
                  </>
                ) : status !== "loading" ? (
                  <>
                    <MenuSeparator />
                    <MenuItem render={<Link href={ROUTES.signIn} />}>
                      <LogIn className="size-4" />
                      Sign in
                    </MenuItem>
                  </>
                ) : null}
              </MenuContent>
            </Menu>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Right - Global Controls */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay: 0.05 }}
        className="absolute top-4 right-4 sm:top-6 sm:right-6 pointer-events-auto"
      >
        <div className="flex items-center gap-1">
          {/* Attestation Queue (authed only) */}
          {showControls && isAuthed && <AttestationQueueButton />}

          {/* Sound Toggle */}
          {showControls && (
            <NavigationButton
              icon={isSoundEnabled ? Volume2 : VolumeX}
              label={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
              onClick={toggleSound}
            />
          )}

          {/* Contextual top-right controls (authed only) */}
          {showControls && isAuthed && controls.topRight?.map((item, idx) => (
            <NavigationButton key={`topRight-${idx}`} {...item} />
          ))}

          {/* Visibility Toggle - Always visible, rightmost */}
          <Tooltip>
            <TooltipTrigger>
              <button
                onClick={toggle}
                className={cn(
                  "flex items-center justify-center",
                  "size-10 rounded-full",
                  "text-muted-foreground hover:text-foreground",
                  "transition-all duration-200",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                )}
              >
                {isVisible ? (
                  <Eye className="size-5" />
                ) : (
                  <EyeOff className="size-5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              <p className="text-xs">{isVisible ? "Hide UI" : "Show UI"}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </motion.div>

      {/* Bottom Left - Community Controls (authed only) */}
      <AnimatePresence>
        {showControls && isAuthed && ((controls.bottomLeft?.length ?? 0) > 0 || (controls.bottomRight?.length ?? 0) > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6 pointer-events-auto"
          >
            <div className="flex items-center gap-1">
              {controls.bottomLeft?.map((item, idx) => (
                <NavigationButton key={`bottomLeft-${idx}`} {...item} />
              ))}
              {controls.bottomRight?.map((item, idx) => (
                <NavigationButton key={`bottomRight-${idx}`} {...item} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attestation Queue Panel (authed only) */}
      {isAuthed && <AttestationQueuePanel />}
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Eye, EyeOff, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { ROUTES, userSettingsPath } from "@/lib/routes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { AttestationQueueButton } from "@/components/attestation/attestation-queue-button";
import { AttestationQueuePanel } from "@/components/attestation/attestation-queue-panel";

/* ────────────────────────────
   Types
──────────────────────────── */

type NavigationControllerProps = {
  /** Logo URL for top-left corner */
  logoUrl?: string | null;
  /** App/site name for logo fallback */
  siteName?: string;
  className?: string;
};

/* ────────────────────────────
   Component
──────────────────────────── */

export function NavigationController({
  logoUrl,
  siteName = "Orbyt",
  className,
}: NavigationControllerProps) {
  const { data: session } = useSession();
  const { controls, isVisible } = useNavigationContext();
  const { toggle } = useNavigationVisibility();

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
      {/* Top Left - Logo/Home */}
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 pointer-events-auto">
        {showControls && (
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <Link
                  {...props}
                  href={ROUTES.home}
                  className={cn(
                    "flex items-center justify-center",
                    "size-10 rounded-full",
                    "bg-background/50 hover:bg-background/80",
                    "backdrop-blur-sm",
                    "border border-border/30 hover:border-border/50",
                    "transition-all duration-200",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  )}
                >
                  <Avatar className="size-8">
                    <AvatarImage src={logoUrl ?? ""} alt={siteName} />
                    <AvatarFallback className="text-xs font-semibold bg-transparent">
                      {siteName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Link>
              )}
            />
            <TooltipContent side="right" sideOffset={8}>
              <p className="text-xs">Home</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Top Right - Global Controls */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 pointer-events-auto">
        <div className="flex items-center gap-2">
          {/* Attestation Queue (cart-like) */}
          {showControls && <AttestationQueueButton />}

          {/* User Settings */}
          {showControls && settingsHref && (
            <NavigationButton
              icon={Settings}
              label="Settings"
              href={settingsHref}
            />
          )}
          {/* Visibility Toggle - Always visible */}
          <Tooltip>
            <TooltipTrigger
              onClick={toggle}
              className={cn(
                "flex items-center justify-center",
                "size-10 rounded-full",
                "text-muted-foreground hover:text-foreground",
                "bg-background/50 hover:bg-background/80",
                "backdrop-blur-sm",
                "border border-border/30 hover:border-border/50",
                "transition-all duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              )}
            >
              {isVisible ? (
                <Eye className="size-5" />
              ) : (
                <EyeOff className="size-5" />
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              <p className="text-xs">{isVisible ? "Hide UI" : "Show UI"}</p>
            </TooltipContent>
          </Tooltip>

          {/* Contextual top-right controls */}
          {showControls && controls.topRight?.map((item, idx) => (
            <NavigationButton key={`topRight-${idx}`} {...item} />
          ))}
        </div>
      </div>

      {/* Bottom Left - Community Controls (horizontal) */}
      {showControls && (controls.bottomLeft?.length > 0 || controls.bottomRight?.length > 0) && (
        <div className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6 pointer-events-auto">
          <div className="flex items-center gap-2">
            {controls.bottomLeft?.map((item, idx) => (
              <NavigationButton key={`bottomLeft-${idx}`} {...item} />
            ))}
            {controls.bottomRight?.map((item, idx) => (
              <NavigationButton key={`bottomRight-${idx}`} {...item} />
            ))}
          </div>
        </div>
      )}

      {/* Attestation Queue Panel (global dialog) */}
      <AttestationQueuePanel />
    </div>
  );
}

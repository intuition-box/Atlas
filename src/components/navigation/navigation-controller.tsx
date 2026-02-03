"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/routes";
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
  type NavigationItem,
} from "./navigation-provider";

/* ────────────────────────────
   Types
──────────────────────────── */

type NavigationControllerProps = {
  /** Logo URL for top-left corner */
  logoUrl?: string | null;
  /** App/site name for logo fallback */
  siteName?: string;
  /** User settings path */
  userSettingsPath?: string;
  className?: string;
};

/* ────────────────────────────
   Component
──────────────────────────── */

export function NavigationController({
  logoUrl,
  siteName = "Orbyt",
  userSettingsPath = "/settings",
  className,
}: NavigationControllerProps) {
  const { controls, isVisible } = useNavigationContext();
  const { toggle } = useNavigationVisibility();

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

          {/* User Settings */}
          {showControls && (
            <NavigationButton
              icon={Settings}
              label="Settings"
              href={userSettingsPath}
            />
          )}

          {/* Contextual top-right controls */}
          {showControls && controls.topRight?.map((item, idx) => (
            <NavigationButton key={`topRight-${idx}`} {...item} />
          ))}
        </div>
      </div>

      {/* Bottom Left - Contextual Controls */}
      {showControls && controls.bottomLeft && controls.bottomLeft.length > 0 && (
        <div className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6 pointer-events-auto">
          <div className="flex flex-col gap-2">
            {controls.bottomLeft.map((item, idx) => (
              <NavigationButton key={`bottomLeft-${idx}`} {...item} />
            ))}
          </div>
        </div>
      )}

      {/* Bottom Right - Contextual Controls (usually admin) */}
      {showControls && controls.bottomRight && controls.bottomRight.length > 0 && (
        <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 pointer-events-auto">
          <div className="flex flex-col gap-2">
            {controls.bottomRight.map((item, idx) => (
              <NavigationButton key={`bottomRight-${idx}`} {...item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

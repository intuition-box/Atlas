"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ────────────────────────────
   Types
──────────────────────────── */

export type NavigationButtonProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  onClick?: () => void;
  isActive?: boolean;
  className?: string;
};

/* ────────────────────────────
   Component
──────────────────────────── */

export function NavigationButton({
  icon: Icon,
  label,
  href,
  onClick,
  isActive = false,
  className,
}: NavigationButtonProps) {
  const buttonClasses = cn(
    "flex items-center justify-center cursor-pointer",
    "size-8 rounded-full",
    "text-muted-foreground hover:bg-input/50 hover:text-foreground",
    "transition-all duration-200",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    isActive && "text-foreground",
    className
  );

  const content = <Icon className="size-4" />;

  if (href) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <Link href={href} className={buttonClasses}>
            {content}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        <button onClick={onClick} className={buttonClasses}>
          {content}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

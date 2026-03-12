"use client";

import { ShoppingCart } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAttestationQueue } from "./queue-provider";
import { Badge } from "@/components/ui/badge";

/* ────────────────────────────
   Component
──────────────────────────── */

export function AttestationQueueButton({ className, disabled }: { className?: string; disabled?: boolean }) {
  const { unminted, toggleOpen, isOpen, buttonRef } = useAttestationQueue();
  const count = unminted.length;

  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          ref={buttonRef}
          data-tour="attestation-queue"
          onClick={disabled ? undefined : toggleOpen}
          disabled={disabled}
          type="button"
          className={cn(
            "relative flex items-center justify-center",
            "size-8 rounded-full",
            "text-muted-foreground",
            "transition-all duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            disabled
              ? "opacity-50 cursor-not-allowed"
              : "cursor-pointer hover:bg-input/50 hover:text-foreground",
            isOpen && !disabled && "text-foreground",
            className
          )}
        >
          <ShoppingCart className="size-4" />
          {count > 0 && !disabled && (
            <Badge
              variant="solid"
              className="absolute -top-1 -right-1 min-w-5 h-5 px-1.5 text-[10px] font-semibold border-2 border-background"
            >
              {count > 99 ? "99+" : count}
            </Badge>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        <p className="text-xs">
          {disabled
            ? "Sign in to use attestations"
            : count > 0
              ? `${count} unminted attestation${count !== 1 ? "s" : ""}`
              : "No unminted attestations"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

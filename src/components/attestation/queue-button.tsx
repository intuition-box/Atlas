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

export function AttestationQueueButton({ className }: { className?: string }) {
  const { unminted, toggleOpen, isOpen, buttonRef } = useAttestationQueue();
  const count = unminted.length;

  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          ref={buttonRef}
          onClick={toggleOpen}
          type="button"
          className={cn(
            "relative flex items-center justify-center cursor-pointer",
            "size-8 rounded-full",
            "text-muted-foreground hover:bg-input/50 hover:text-foreground",
            "transition-all duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            isOpen && "text-foreground",
            className
          )}
        >
          <ShoppingCart className="size-4" />
          {count > 0 && (
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
          {count > 0
            ? `${count} unminted attestation${count !== 1 ? "s" : ""}`
            : "No unminted attestations"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

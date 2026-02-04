"use client";

import * as React from "react";
import { FileCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAttestationQueue } from "./attestation-queue-provider";

/* ────────────────────────────
   Component
──────────────────────────── */

export function AttestationQueueButton({ className }: { className?: string }) {
  const { queue, toggleOpen, isOpen } = useAttestationQueue();
  const count = queue.length;

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={toggleOpen}
        className={cn(
          "relative flex items-center justify-center",
          "size-10 rounded-full",
          "text-muted-foreground hover:text-foreground",
          "bg-background/50 hover:bg-background/80",
          "backdrop-blur-sm",
          "border border-border/30 hover:border-border/50",
          "transition-all duration-200",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          isOpen && "text-foreground bg-background/80 border-border/50",
          className
        )}
      >
        <FileCheck className="size-5" />
        {/* Badge - only show when there are items */}
        {count > 0 && (
          <span
            className={cn(
              "absolute -top-1 -right-1",
              "flex items-center justify-center",
              "min-w-5 h-5 px-1.5",
              "text-[10px] font-semibold",
              "bg-primary text-primary-foreground",
              "rounded-full",
              "border-2 border-background"
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        <p className="text-xs">
          {count > 0
            ? `${count} attestation${count !== 1 ? "s" : ""} queued`
            : "Attestations"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

"use client";

import { FileCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAttestationQueue } from "./attestation-queue-provider";
import { Button } from "@/components/ui/button";

/* ────────────────────────────
   Component
──────────────────────────── */

export function AttestationQueueButton({ className }: { className?: string }) {
  const { queue, toggleOpen, isOpen, buttonRef } = useAttestationQueue();
  const count = queue.length;

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          ref={buttonRef}
          variant="ghost"
          size="icon"
          onClick={toggleOpen}
          type="button"
          className={cn(
            "relative size-10 rounded-full",
            "bg-background/50 hover:bg-background/80",
            "backdrop-blur-sm",
            "border border-border/30 hover:border-border/50",
            isOpen && "bg-background/80 border-border/50",
            className
          )}
        >
          <FileCheck className="size-5" />
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
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        <p className="text-xs">
          {count > 0
            ? `${count} attestation${count !== 1 ? "s" : ""} queued`
            : "No attestations queued"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

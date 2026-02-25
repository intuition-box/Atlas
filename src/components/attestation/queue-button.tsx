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
import { Button } from "@/components/ui/button";

/* ────────────────────────────
   Component
──────────────────────────── */

export function AttestationQueueButton({ className }: { className?: string }) {
  const { unminted, toggleOpen, isOpen, buttonRef } = useAttestationQueue();
  const count = unminted.length;

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
            isOpen && "text-foreground",
            className
          )}
        >
          <ShoppingCart className="size-5" />
          {count > 0 && (
            <Badge
              variant="solid"
              className="absolute -top-1 -right-1 min-w-5 h-5 px-1.5 text-[10px] font-semibold border-2 border-background"
            >
              {count > 99 ? "99+" : count}
            </Badge>
          )}
        </Button>
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

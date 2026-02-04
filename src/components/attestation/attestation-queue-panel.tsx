"use client";

import * as React from "react";
import { X, Send, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { useAttestationQueue, type QueuedAttestation } from "./attestation-queue-provider";
import { ATTESTATION_TYPES } from "@/config/attestations";

/* ────────────────────────────
   Queue Item Component
──────────────────────────── */

function QueueItem({
  item,
  onRemove,
}: {
  item: QueuedAttestation;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/30">
      <Avatar className="size-10 shrink-0">
        <AvatarImage src={item.toAvatarUrl ?? ""} alt={item.toName} />
        <AvatarFallback className="text-xs font-medium">
          {item.toName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{item.toName}</span>
          <span className="text-xs text-muted-foreground">@{item.toHandle}</span>
        </div>
        <div className="mt-0.5">
          <span className="text-xs text-muted-foreground">
            {ATTESTATION_TYPES[item.type].label}
          </span>
        </div>
      </div>

      <button
        onClick={() => onRemove(item.id)}
        className={cn(
          "p-1 rounded-md shrink-0",
          "text-muted-foreground hover:text-foreground",
          "hover:bg-muted/50",
          "transition-colors"
        )}
        aria-label="Remove attestation"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/* ────────────────────────────
   Main Panel Component
──────────────────────────── */

export function AttestationQueuePanel() {
  const { queue, removeFromQueue, clearQueue, isOpen, setIsOpen } = useAttestationQueue();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmitAll = async () => {
    if (queue.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Submit all attestations in parallel
      const results = await Promise.allSettled(
        queue.map(async (item) => {
          const response = await fetch("/api/attestation/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              toUserId: item.toUserId,
              type: item.type,
            }),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Failed to create attestation");
          }

          return item.id;
        })
      );

      // Remove successfully submitted attestations
      const successfulIds = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);

      for (const id of successfulIds) {
        removeFromQueue(id);
      }

      // Check for failures
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        setError(`${failures.length} attestation(s) failed to submit`);
      } else {
        // All successful - close panel
        setIsOpen(false);
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Attestation Queue</SheetTitle>
          <SheetDescription>
            Review and submit your queued attestations
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <p className="text-muted-foreground text-sm">
                No attestations queued
              </p>
              <p className="text-muted-foreground/60 text-xs mt-1">
                Add attestations from member profiles
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {queue.map((item) => (
                <QueueItem
                  key={item.id}
                  item={item}
                  onRemove={removeFromQueue}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <SheetFooter>
          {queue.length > 0 && (
            <>
              <Button
                variant="ghost"
                onClick={clearQueue}
                disabled={isSubmitting}
                className="flex-1"
              >
                Clear All
              </Button>
              <Button
                onClick={handleSubmitAll}
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="size-4 mr-2" />
                    Submit {queue.length} Attestation{queue.length !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

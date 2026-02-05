"use client";

import * as React from "react";
import { X, Save, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { apiPost } from "@/lib/api/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAttestationQueue, type QueuedAttestation } from "./attestation-queue-provider";
import { ATTESTATION_TYPES, type AttestationType } from "@/config/attestations";

/* ────────────────────────────
   Helpers
──────────────────────────── */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

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
  const attestationType = ATTESTATION_TYPES[item.type];

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30">
      <Avatar className="size-9 shrink-0">
        <AvatarImage src={item.toAvatarUrl ?? ""} alt={item.toName} />
        <AvatarFallback className="text-xs font-medium">
          {initials(item.toName)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{item.toName}</span>
          {item.toHandle && (
            <span className="text-xs text-muted-foreground">@{item.toHandle}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {attestationType.label}
        </span>
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
  const { queue, removeFromQueue, clearQueue, isOpen, setIsOpen, markSaved } = useAttestationQueue();
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSaveAll = async () => {
    if (queue.length === 0) return;

    setIsSaving(true);
    setError(null);

    try {
      // Save all attestations in parallel
      const results = await Promise.allSettled(
        queue.map(async (item) => {
          const result = await apiPost<{ attestation: { id: string } }>(
            "/api/attestation/create",
            {
              toUserId: item.toUserId,
              type: item.type,
            }
          );

          if (!result.ok) {
            throw new Error(result.error.message || "Failed to save attestation");
          }

          return item.id;
        })
      );

      // Remove successfully saved attestations
      const successfulIds = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);

      for (const id of successfulIds) {
        removeFromQueue(id);
      }

      // Check for failures
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        setError(`${failures.length} attestation(s) failed to save`);
      }

      // If any succeeded, mark as saved so buttons refetch their state
      if (successfulIds.length > 0) {
        markSaved();
      }

      // All successful - close dialog
      if (failures.length === 0) {
        setIsOpen(false);
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attestation Queue</DialogTitle>
          <DialogDescription>
            Review and save your queued attestations.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <p className="text-muted-foreground text-sm">
                No attestations queued.
              </p>
              <p className="mt-1">
                Attestations strengthen relationships between users. When you and
                the recipient share a community, your attestations increase their <span className="text-foreground font-medium">Reach</span> (visibility) and your <span className="text-foreground font-medium">Love</span> (participation).
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

        {queue.length > 0 && (
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={clearQueue}
              disabled={isSaving}
            >
              Clear All
            </Button>
            <Button
              onClick={handleSaveAll}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="size-4 mr-2" />
                  Save {queue.length}
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

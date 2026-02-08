"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { X, Save, Loader2, Trash2, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { apiPost } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";
import { userAttestationsPath } from "@/lib/routes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAttestationQueue, type QueuedAttestation } from "./attestation-queue-provider";
import { ATTESTATION_TYPES, type AttestationType } from "@/lib/attestations/definitions";
import { TrashIcon } from "../ui/icons";

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
  const { data: session } = useSession();
  const { queue, removeFromQueue, removeMultiple, clearQueue, isOpen, setIsOpen, markSaved } = useAttestationQueue();
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pathname = usePathname();

  const userHandle = session?.user?.handle;
  const attestationsPath = userHandle ? userAttestationsPath(userHandle) : null;
  const isOnAttestationsPage = attestationsPath && pathname === attestationsPath;

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

      // Check for failures
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        setError(`${failures.length} attestation(s) failed to save`);
      }

      // If any succeeded, remove from queue and trigger refetch
      if (successfulIds.length > 0) {
        removeMultiple(successfulIds);
        markSaved();
        sounds.success();
      }

      // Play error sound if any failed
      if (failures.length > 0) {
        sounds.error();
      }
    } catch {
      setError("Something went wrong");
      sounds.error();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="relative">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>Attestation Queue</DialogTitle>
              <DialogDescription>
                Review and save your queued attestations.
              </DialogDescription>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Clear all */}
              {queue.length > 0 && (
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={clearQueue}
                      disabled={isSaving}
                      className="text-red-500 hover:text-red-600"
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear all</TooltipContent>
                </Tooltip>
              )}

              {/* Save */}
              {queue.length > 0 && (
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleSaveAll}
                      disabled={isSaving}
                      className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
                    >
                      {isSaving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Save {queue.length}</TooltipContent>
                </Tooltip>
              )}

              {/* Attestations page - hide if already on that page */}
              {attestationsPath && !isOnAttestationsPage && (
                <Tooltip>
                  <TooltipTrigger>
                    <Link
                      href={attestationsPath}
                      onClick={() => setIsOpen(false)}
                      className={cn(
                        "focus-visible:border-ring focus-visible:ring-ring/50 rounded-4xl border border-transparent text-sm font-medium focus-visible:ring-[3px] inline-flex items-center justify-center transition-all outline-none select-none",
                        "size-8 text-primary hover:text-primary hover:bg-primary/10"
                      )}
                    >
                      <ExternalLink className="size-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>View attestations</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
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

      </DialogContent>
    </Dialog>
  );
}

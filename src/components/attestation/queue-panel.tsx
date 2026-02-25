"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { apiPost } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";
import { userAttestationsPath } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAttestationQueue, type QueuedAttestation } from "./queue-provider";
import { AttestationBadge } from "@/components/attestation/badge";
import { ProfileAvatar } from "@/components/common/profile-avatar";

/* ────────────────────────────
   Helpers
──────────────────────────── */

/* ────────────────────────────
   Queue Item Component
──────────────────────────── */

function QueueItem({
  item,
  onRemove,
  onSave,
  isSaving,
}: {
  item: QueuedAttestation;
  onRemove: (id: string) => void;
  onSave: (id: string) => void;
  isSaving: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30">
      <ProfileAvatar type="user" src={item.toAvatarUrl} name={item.toName} className="size-9 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{item.toName}</span>
          {item.toHandle && (
            <span className="text-xs text-muted-foreground">@{item.toHandle}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          <AttestationBadge type={item.type} bare />
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="secondary"
          size="icon-xs"
          onClick={() => onRemove(item.id)}
          disabled={isSaving}
          aria-label="Remove attestation"
        >
          <X className="size-3.5" />
        </Button>
        <Button
          variant="secondary"
          size="icon-xs"
          onClick={() => onSave(item.id)}
          disabled={isSaving}
          aria-label="Save attestation"
        >
          {isSaving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
        </Button>
      </div>
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
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const pathname = usePathname();

  const userHandle = session?.user?.handle;
  const attestationsPath = userHandle ? userAttestationsPath(userHandle) : null;
  const isOnAttestationsPage = attestationsPath && pathname === attestationsPath;

  const handleSaveOne = async (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;

    setSavingIds((prev) => new Set(prev).add(id));
    setError(null);

    try {
      const result = await apiPost<{ attestation: { id: string } }>(
        "/api/attestation/create",
        { toUserId: item.toUserId, type: item.type },
      );

      if (!result.ok) {
        setError("Failed to save attestation");
        sounds.error();
        return;
      }

      removeFromQueue(id);
      markSaved();
      sounds.success();
    } catch {
      setError("Something went wrong");
      sounds.error();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

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
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader className="relative">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>Attestation Queue</DialogTitle>
              <DialogDescription>
                Review before saving your attestations.
              </DialogDescription>
            </div>

            {attestationsPath && !isOnAttestationsPage && (
              <Button
                variant="default"
                render={<Link href={attestationsPath} onClick={() => setIsOpen(false)} />}
              >
                Attestations
              </Button>
            )}
          </div>
        </DialogHeader>

        <div
          className={cn(
            "max-h-[28rem] overflow-y-auto pr-2 [scrollbar-width:thin] [scrollbar-color:oklch(1_0_0/20%)_transparent]",
            queue.length > 0 && "[mask-image:linear-gradient(transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]"
          )}
        >
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
            <div className="flex flex-col gap-3 py-2">
              {queue.map((item) => (
                <QueueItem
                  key={item.id}
                  item={item}
                  onRemove={removeFromQueue}
                  onSave={handleSaveOne}
                  isSaving={savingIds.has(item.id)}
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
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="destructive"
              onClick={clearQueue}
              disabled={isSaving}
            >
              Delete all
            </Button>
            <Button
              variant="positive"
              onClick={handleSaveAll}
              disabled={isSaving}
            >
              {isSaving ? "Saving\u2026" : "Save all"}
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}

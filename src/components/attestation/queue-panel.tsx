"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { CheckCircle, Loader2, X } from "lucide-react";

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
import { useAttestationQueue, type UnmintedAttestation } from "./queue-provider";
import { AttestationBadge } from "@/components/attestation/badge";
import { ProfileAvatar } from "@/components/common/profile-avatar";

/* ────────────────────────────
   Cart Item Component
──────────────────────────── */

function CartItem({
  item,
  onDelete,
  isMinting,
  isActing,
}: {
  item: UnmintedAttestation;
  onDelete: (id: string) => void;
  isMinting: boolean;
  isActing: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30">
      <ProfileAvatar type="user" src={item.toUser.avatarUrl} name={item.toUser.name ?? ""} className="size-9 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{item.toUser.name}</span>
          {item.toUser.handle && (
            <span className="text-xs text-muted-foreground">@{item.toUser.handle}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          <AttestationBadge type={item.type} bare />
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isMinting ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={() => onDelete(item.id)}
            disabled={isActing}
            aria-label="Delete attestation"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────
   Main Panel Component
──────────────────────────── */

export function AttestationQueuePanel() {
  const { data: session } = useSession();
  const {
    unminted,
    isFetching,
    isOpen,
    setIsOpen,
    retractAttestation,
    retractAll,
    onItemMinted,
  } = useAttestationQueue();

  const [isMinting, setIsMinting] = React.useState(false);
  const [mintingIds, setMintingIds] = React.useState<Set<string>>(new Set());
  const [mintComplete, setMintComplete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pathname = usePathname();

  const userHandle = session?.user?.handle;
  const attestationsPath = userHandle ? userAttestationsPath(userHandle) : null;
  const isOnAttestationsPage = attestationsPath && pathname === attestationsPath;

  // Reset mint complete state when panel opens with new items
  React.useEffect(() => {
    if (isOpen && unminted.length > 0) {
      setMintComplete(false);
    }
  }, [isOpen, unminted.length]);

  const handleDelete = async (id: string) => {
    setError(null);
    await retractAttestation(id);
  };

  const handleDeleteAll = async () => {
    setError(null);
    await retractAll();
  };

  const handleMintAll = async () => {
    if (unminted.length === 0) return;

    setIsMinting(true);
    setError(null);

    // Snapshot items to mint
    const toMint = [...unminted];

    // Start looping mint sound
    const loopControl = await sounds.loopMintAll();

    try {
      let failures = 0;

      for (const item of toMint) {
        setMintingIds((prev) => new Set(prev).add(item.id));

        try {
          // Simulate blockchain call (will be replaced with Intuition SDK)
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Persist mint state to database
          const result = await apiPost<{
            attestation: { id: string; mintedAt: string };
            alreadyMinted: boolean;
          }>("/api/attestation/mint", {
            attestationId: item.id,
          });

          if (result.ok) {
            onItemMinted(item.id);
          } else {
            failures++;
          }
        } catch {
          failures++;
        } finally {
          setMintingIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
        }
      }

      if (failures > 0) {
        setError(`${failures} attestation(s) failed to mint`);
      }

      setMintComplete(true);
    } finally {
      loopControl.stop();
      sounds.mint();
      setIsMinting(false);
    }
  };

  const isActing = isMinting;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader className="relative">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>Attestation Cart</DialogTitle>
              <DialogDescription>
                Manage your unminted attestations.
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
            "max-h-[28rem] overflow-y-auto pr-4 [scrollbar-width:thin] [scrollbar-color:oklch(1_0_0/20%)_transparent]",
            unminted.length > 0 && "[mask-image:linear-gradient(transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]"
          )}
        >
          {isFetching && unminted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : mintComplete && unminted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-3">
              <CheckCircle className="size-8 text-positive" />
              <div>
                <p className="text-sm font-medium">
                  All attestations minted onchain!
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your attestations are now permanently recorded.
                </p>
              </div>
            </div>
          ) : unminted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <p className="text-muted-foreground text-sm">
                No unminted attestations.
              </p>
              <p className="mt-1">
                Attestations strengthen relationships between users. When you and
                the recipient share a community, your attestations increase their <span className="text-foreground font-medium">Reach</span> (visibility) and your <span className="text-foreground font-medium">Love</span> (participation).
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 py-2">
              {unminted.map((item) => (
                <CartItem
                  key={item.id}
                  item={item}
                  onDelete={handleDelete}
                  isMinting={mintingIds.has(item.id)}
                  isActing={isActing}
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

        {unminted.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={isActing}
            >
              Delete all
            </Button>
            <Button
              variant="positive"
              onClick={handleMintAll}
              disabled={isActing}
            >
              {isMinting ? "Minting\u2026" : "Mint all"}
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}

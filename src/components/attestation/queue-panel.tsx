"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useAccount, useSwitchChain, useChainId } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CheckCircle, Loader2, X, Wallet } from "lucide-react";
import type { Address } from "viem";

import { cn } from "@/lib/utils";
import { apiPost } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";
import { userAttestationsPath } from "@/lib/routes";
import { batchCreateAttestations } from "@/lib/intuition/client";
import { INTUITION_CHAIN } from "@/lib/intuition/config";
import type { BatchMintItem } from "@/lib/intuition/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getAttributeById } from "@/lib/attestations/definitions";
import { useAttestationQueue, type UnmintedAttestation } from "./queue-provider";
import { AttestationBadge } from "@/components/attestation/badge";
import { ProfileAvatar } from "@/components/common/profile-avatar";

/* ────────────────────────────
   Cart Item Component
──────────────────────────── */

function CartItem({
  item,
  onDelete,
  isActing,
}: {
  item: UnmintedAttestation;
  onDelete: (id: string) => void;
  isActing: boolean;
}) {
  const hasWallet = Boolean(item.toUser.walletAddress);

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30",
      !hasWallet && "opacity-50",
    )}>
      <ProfileAvatar type="user" src={item.toUser.avatarUrl} name={item.toUser.name ?? ""} className="size-9 shrink-0" />

      {/* Stance indicator */}
      <span className="text-sm shrink-0" title={item.stance === "against" ? "Oppose" : "Support"}>
        {item.stance === "against" ? "\ud83d\udc4e" : "\ud83d\udc4d"}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{item.toUser.name}</span>
          {item.toUser.handle && (
            <span className="text-xs text-muted-foreground">@{item.toUser.handle}</span>
          )}
          {!hasWallet && (
            <span className="inline-flex items-center gap-1 text-[10px] text-warning-foreground/70">
              <Wallet className="size-2.5" />
              No wallet
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          <AttestationBadge type={item.type} bare />
          {(item.type === "SKILL_ENDORSE" || item.type === "TOOL_ENDORSE") && item.attributeId && (
            <span className="ml-1 text-foreground/60">{getAttributeById(item.attributeId)?.label ?? item.attributeId}</span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="secondary"
          size="icon-xs"
          onClick={() => onDelete(item.id)}
          disabled={isActing}
          aria-label="Delete attestation"
        >
          <X className="size-3.5" />
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
  const [mintComplete, setMintComplete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pathname = usePathname();

  // Wallet state
  const viewerWallet = session?.user?.walletAddress ?? null;
  const hasWallet = Boolean(viewerWallet);
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();

  // Partition items: mintable (toUser has wallet) vs unmintable
  const mintable = React.useMemo(
    () => unminted.filter((i) => Boolean(i.toUser.walletAddress)),
    [unminted],
  );
  const unmintableCount = unminted.length - mintable.length;

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
    if (isMinting || mintable.length === 0) return;

    // Guard: viewer must have a linked wallet
    if (!viewerWallet) {
      setError("Link a wallet in Settings to publish attestations.");
      return;
    }

    // Guard: wallet must be connected and match the linked wallet
    if (!connectedAddress || connectedAddress.toLowerCase() !== viewerWallet.toLowerCase()) {
      setError(
        `Connect wallet ${viewerWallet.slice(0, 6)}…${viewerWallet.slice(-4)} to publish.`,
      );
      if (openConnectModal) openConnectModal();
      return;
    }

    // Ensure wallet is on the Intuition chain
    if (chainId !== INTUITION_CHAIN.id) {
      try {
        await switchChainAsync({ chainId: INTUITION_CHAIN.id });
      } catch (switchErr) {
        // eslint-disable-next-line no-console
        console.error("[queue-panel] Chain switch failed", {
          currentChainId: chainId,
          targetChainId: INTUITION_CHAIN.id,
          error: switchErr,
        });
        setError(
          `Switch your wallet to ${INTUITION_CHAIN.name} and try again.`,
        );
        return;
      }
    }

    setIsMinting(true);
    setError(null);

    // Start looping mint sound
    const loopControl = await sounds.loopMintAll();
    let success = false;

    try {
      // Build batch items (only mintable ones with toUser wallet)
      const batchItems: BatchMintItem[] = mintable.map((item) => ({
        attestationId: item.id,
        type: item.type,
        toAddress: item.toUser.walletAddress as Address,
      }));

      // Execute on-chain batch (wallet signatures happen here)
      const result = await batchCreateAttestations(
        viewerWallet as Address,
        batchItems,
      );

      // Persist mint results to DB
      const persistResult = await apiPost<{
        minted: Array<{ id: string; mintedAt: string }>;
        skipped: string[];
      }>("/api/attestation/batch-mint", {
        items: result.items.map((item) => ({
          attestationId: item.attestationId,
          txHash: result.triplesTxHash,
          onchainId: item.onchainId,
        })),
      });

      if (!persistResult.ok) {
        setError("Published on-chain but failed to save. Refresh the page to sync.");
        setMintComplete(true);
        return;
      }

      // Remove minted items from the panel
      for (const m of persistResult.value.minted) {
        onItemMinted(m.id);
      }

      // Show info about skipped items (recipients without wallets)
      if (unmintableCount > 0) {
        setError(
          `${unmintableCount} attestation${unmintableCount !== 1 ? "s" : ""} skipped — recipient${unmintableCount !== 1 ? "s have" : " has"} no linked wallet.`,
        );
      }

      setMintComplete(true);
      success = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publishing failed";
      setError(message);
    } finally {
      loopControl.stop();
      if (success) sounds.mint();
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
                  All attestations published onchain!
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
                  isActing={isActing}
                />
              ))}
            </div>
          )}

          </div>

        {unminted.length > 0 && (
          <div className="flex flex-col gap-2">
            {error && (
              <div role="alert" aria-live="polite" className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 overflow-hidden">
                <p className="text-sm text-destructive text-center break-words line-clamp-3">{error}</p>
              </div>
            )}
            {!hasWallet && (
              <p className="text-sm text-warning-foreground/70 text-center">
                Link a wallet in Settings to publish attestations onchain.
              </p>
            )}
            {unmintableCount > 0 && hasWallet && (
              <p className="text-xs text-muted-foreground text-center">
                {unmintableCount} item{unmintableCount !== 1 ? "s" : ""} will be skipped (recipient has no wallet)
              </p>
            )}
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
                disabled={isActing || !hasWallet || mintable.length === 0}
              >
                {isMinting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Publishing…
                  </>
                ) : (
                  `Publish ${mintable.length}`
                )}
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}

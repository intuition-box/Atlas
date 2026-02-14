"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Loader2 } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EncryptedText } from "@/components/ui/encrypted-text";
import { WalletIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/* ────────────────────────────
   Types
──────────────────────────── */

type WalletRow = {
  address: string;
  linkedAt: string;
};

type WalletMeResponse = {
  wallets: WalletRow[];
};

type RequestMessageResponse = {
  message: string;
  ts: number;
  nonce: string;
  validUntil: number;
};

type LinkResponse = {
  linked: boolean;
  address: string;
};

type Status = {
  type: "idle" | "linking" | "unlinking" | "success" | "error";
  message?: string;
};

/* ────────────────────────────
   Helpers
──────────────────────────── */

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/* ────────────────────────────
   Component
──────────────────────────── */

/**
 * Wallet management card for the user settings page.
 *
 * Displays all linked wallets in a grid with unlink buttons,
 * plus a card to connect and link a new wallet.
 */
export function WalletLinkSection() {
  const { address: connectedAddress, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [pendingLink, setPendingLink] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* ────────── Fetch linked wallets ────────── */

  const fetchWallets = useCallback(async () => {
    const result = await apiGet<WalletMeResponse>("/api/wallet/me");
    if (!mountedRef.current) return;

    if (result.ok) {
      setWallets(result.value.wallets);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  /* ────────── Link flow ────────── */

  const linkWallet = useCallback(async (addr: string) => {
    if (!mountedRef.current) return;
    setStatus({ type: "linking", message: "Requesting message…" });

    // 1. Request message
    const msgResult = await apiPost<RequestMessageResponse>(
      "/api/wallet/request-message",
      { address: addr },
    );
    if (!msgResult.ok) {
      if (mountedRef.current) {
        setStatus({ type: "error", message: "Failed to request message" });
      }
      return;
    }

    // 2. Sign message
    if (mountedRef.current) {
      setStatus({ type: "linking", message: "Please sign the message in your wallet…" });
    }

    let signature: string;
    try {
      signature = await signMessageAsync({ message: msgResult.value.message });
    } catch {
      if (mountedRef.current) {
        setStatus({ type: "error", message: "Signing cancelled" });
      }
      return;
    }

    // 3. Submit to link endpoint
    if (mountedRef.current) {
      setStatus({ type: "linking", message: "Verifying…" });
    }

    const linkResult = await apiPost<LinkResponse>("/api/wallet/link", {
      address: addr,
      message: msgResult.value.message,
      signature,
    });

    if (!mountedRef.current) return;

    if (linkResult.ok) {
      await fetchWallets();
      setStatus({ type: "success", message: "Wallet linked!" });
      setTimeout(() => {
        if (mountedRef.current) setStatus({ type: "idle" });
      }, 3_000);
    } else {
      setStatus({ type: "error", message: "Failed to link wallet" });
    }
  }, [signMessageAsync, fetchWallets]);

  /* ────────── Auto-link after connect ────────── */

  useEffect(() => {
    if (pendingLink && isConnected && connectedAddress) {
      setPendingLink(false);
      linkWallet(connectedAddress);
    }
  }, [pendingLink, isConnected, connectedAddress, linkWallet]);

  /* ────────── Connect + link ────────── */

  const handleConnectAndLink = useCallback(() => {
    if (isConnected && connectedAddress) {
      linkWallet(connectedAddress);
    } else {
      setPendingLink(true);
      openConnectModal?.();
    }
  }, [isConnected, connectedAddress, linkWallet, openConnectModal]);

  /* ────────── Unlink flow ────────── */

  const handleUnlink = useCallback(async (address: string) => {
    setStatus({ type: "unlinking", message: "Unlinking…" });

    const result = await apiPost<{ unlinked: boolean }>("/api/wallet/unlink", {
      address,
    });

    if (!mountedRef.current) return;

    if (result.ok) {
      await fetchWallets();
      if (connectedAddress?.toLowerCase() === address.toLowerCase()) {
        disconnect();
      }
      setStatus({ type: "success", message: "Wallet unlinked" });
      setTimeout(() => {
        if (mountedRef.current) setStatus({ type: "idle" });
      }, 3_000);
    } else {
      setStatus({ type: "error", message: "Failed to unlink wallet" });
    }
  }, [connectedAddress, disconnect, fetchWallets]);

  /* ────────── Render ────────── */

  const isWorking = status.type === "linking" || status.type === "unlinking";

  // Check if the currently connected wallet is already linked
  const connectedIsLinked = connectedAddress
    ? wallets.some((w) => w.address === connectedAddress.toLowerCase())
    : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallets</CardTitle>
        <CardDescription>Link wallets for attestation minting and identity verification.</CardDescription>
      </CardHeader>

      <CardContent className="px-5">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 p-3">
              <Skeleton className="mb-2 h-3 w-16" />
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <Skeleton className="mb-2 h-3 w-16" />
              <Skeleton className="h-5 w-32" />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Linked wallet cards */}
            {wallets.map((wallet) => (
              <div
                key={wallet.address}
                className="rounded-lg border border-border/60 p-3 text-sm"
              >
                <h2 className="text-xs font-medium text-muted-foreground mb-1">Linked</h2>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <WalletIcon className="size-4 shrink-0" />
                    <EncryptedText
                      text={truncateAddress(wallet.address)}
                      revealDelayMs={40}
                      flipDelayMs={30}
                      className="font-mono text-sm text-foreground/80"
                    />
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isWorking}
                        />
                      }
                    >
                      {isWorking ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Unlink"
                      )}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Unlink wallet?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will disconnect {truncateAddress(wallet.address)} from your account.
                          You can always link it again later.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleUnlink(wallet.address)}
                        >
                          Unlink
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}

            <div className="rounded-lg border border-dashed p-3 text-sm">
              <h2 className="text-xs font-medium text-amber-400/70 mb-1">Connect</h2>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <WalletIcon className="size-4 shrink-0 text-amber-400" />
                  <EncryptedText
                    text="0x0000…0000"
                    scrambleOnly
                    scrambleOneChar
                    className="font-mono text-sm text-amber-400"
                  />
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 dark:bg-amber-400/20 dark:hover:bg-amber-400/30"
                  onClick={handleConnectAndLink}
                  disabled={isWorking}
                >
                  {isWorking && status.type === "linking" ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Linking…
                    </>
                  ) : (
                    "Add wallet"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Status message */}
        {status.message && status.type !== "idle" && (
          <p
            className={`mt-3 text-xs ${
              status.type === "error"
                ? "text-destructive"
                : status.type === "success"
                  ? "text-emerald-500"
                  : "text-muted-foreground"
            }`}
          >
            {status.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

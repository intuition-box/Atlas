"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useAccount, useSignMessage, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Loader2, Wallet } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EncryptedText } from "@/components/ui/encrypted-text";
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
  /** The wallet address this status relates to. */
  address?: string;
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
  const { data: session } = useSession();
  const { address: connectedAddress, isConnected } = useAccount();
  const signMessage = useSignMessage();
  const disconnectWallet = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const sessionWallet = session?.user?.walletAddress;
  const [wallets, setWallets] = useState<WalletRow[]>(
    sessionWallet ? [{ address: sessionWallet, linkedAt: "" }] : []
  );
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [pendingLink, setPendingLink] = useState(false);
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState<string | null>(null);

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
    setStatus({ type: "linking", message: "Requesting message…", address: addr });

    // 1. Request message
    const msgResult = await apiPost<RequestMessageResponse>(
      "/api/wallet/request-message",
      { address: addr },
    );
    if (!msgResult.ok) {
      if (mountedRef.current) {
        setStatus({ type: "error", message: "Failed to request message", address: addr });
      }
      return;
    }

    // 2. Sign message
    if (mountedRef.current) {
      setStatus({ type: "linking", message: "Please sign the message in your wallet…", address: addr });
    }

    let signature: string;
    try {
      signature = await signMessage.mutateAsync({ message: msgResult.value.message });
    } catch {
      if (mountedRef.current) {
        setStatus({ type: "error", message: "Signing cancelled", address: addr });
      }
      return;
    }

    // 3. Submit to link endpoint
    if (mountedRef.current) {
      setStatus({ type: "linking", message: "Verifying…", address: addr });
    }

    const linkResult = await apiPost<LinkResponse>("/api/wallet/link", {
      address: addr,
      message: msgResult.value.message,
      signature,
    });

    if (!mountedRef.current) return;

    if (linkResult.ok) {
      await fetchWallets();
      setStatus({ type: "success", message: "Wallet linked!", address: addr });
      setTimeout(() => {
        if (mountedRef.current) setStatus({ type: "idle" });
      }, 3_000);
    } else {
      setStatus({ type: "error", message: "Failed to link wallet", address: addr });
    }
  }, [signMessage, fetchWallets]);

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
    setStatus({ type: "unlinking", message: "Unlinking…", address });

    const result = await apiPost<{ unlinked: boolean }>("/api/wallet/unlink", {
      address,
    });

    if (!mountedRef.current) return;

    if (result.ok) {
      if (connectedAddress?.toLowerCase() === address.toLowerCase()) {
        disconnectWallet.mutate();
      }
      setStatus({ type: "success", message: "Wallet unlinked", address });
      setTimeout(async () => {
        if (!mountedRef.current) return;
        await fetchWallets();
        setStatus({ type: "idle" });
      }, 3_000);
    } else {
      setStatus({ type: "error", message: "Failed to unlink wallet", address });
    }
  }, [connectedAddress, disconnectWallet, fetchWallets]);

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

      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Linked wallet cards */}
          {wallets.map((wallet) => {
            const walletStatus =
              status.address?.toLowerCase() === wallet.address.toLowerCase() &&
              status.type !== "idle" && status.type !== "linking"
                ? status
                : null;

            return (
              <div
                key={wallet.address}
                className="relative overflow-hidden rounded-lg border border-border/60 p-3 text-sm"
              >
                <h2 className="text-xs font-medium text-muted-foreground mb-1">Linked</h2>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Wallet className="size-4 shrink-0" />
                    <EncryptedText
                      text={truncateAddress(wallet.address)}
                      scrambleOnly={loading}
                      scrambleOneChar={loading}
                      revealDelayMs={40}
                      flipDelayMs={30}
                      className="font-mono text-sm text-foreground/80"
                    />
                  </div>
                  <AlertDialog
                    open={unlinkDialogOpen === wallet.address}
                    onOpenChange={(open) => setUnlinkDialogOpen(open ? wallet.address : null)}
                  >
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={status.type === "unlinking"}
                        />
                      }
                    >
                      {status.type === "unlinking" && status.address?.toLowerCase() === wallet.address.toLowerCase() ? (
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
                          onClick={() => {
                            setUnlinkDialogOpen(null);
                            handleUnlink(wallet.address);
                          }}
                        >
                          Unlink
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {/* Status overlay scoped to this wallet */}
                {walletStatus?.message ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-card/80 backdrop-blur-sm">
                    <p
                      className={`text-xs font-medium ${
                        walletStatus.type === "error"
                          ? "text-destructive"
                          : walletStatus.type === "success"
                            ? "text-emerald-500"
                            : "text-muted-foreground"
                      }`}
                    >
                      {walletStatus.message}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* Add wallet card */}
          <div className="relative overflow-hidden rounded-lg border border-dashed border-amber-400/40 p-3 text-sm">
            <h2 className="text-xs font-medium text-amber-400/70 mb-1">Connect</h2>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Wallet className="size-4 shrink-0 text-amber-400" />
                <EncryptedText
                  text="0x0000…0000"
                  scrambleOnly
                  scrambleOneChar
                  className="font-mono text-sm text-amber-400"
                />
              </div>
              <Button
                size="sm"
                onClick={handleConnectAndLink}
                disabled={isWorking || loading}
                className="bg-amber-400/15 text-amber-400 hover:bg-amber-400/25"
              >
                {status.type === "linking" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Linking…
                  </>
                ) : (
                  "Add wallet"
                )}
              </Button>
            </div>

            {/* Overlay: linking progress + errors for wallets not yet in the list */}
            {status.message &&
              (status.type === "linking" ||
                (status.type === "error" && status.address && !wallets.some((w) => w.address.toLowerCase() === status.address!.toLowerCase()))) ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-card/80 backdrop-blur-sm">
                <p
                  className={`text-xs font-medium ${
                    status.type === "error" ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {status.message}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

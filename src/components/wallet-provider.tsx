"use client";

import { type ReactNode, useEffect } from "react";
import { WagmiProvider, useAccount, useConnections } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { walletConfig } from "@/lib/intuition/wallet";
import { setWalletClient } from "@/lib/intuition/client";

import "@rainbow-me/rainbowkit/styles.css";

/* ────────────────────────────
   Query Client (stable singleton)
──────────────────────────── */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
});

/* ────────────────────────────
   Connector Sync
──────────────────────────── */

/**
 * Syncs the active wagmi connector's provider into the Intuition client.
 *
 * Uses the connector's `getProvider()` method to get the exact provider
 * the user connected with (MetaMask, Rabby, Phantom, etc.), then passes
 * it to our Intuition client to build a viem WalletClient from.
 */
function ConnectorSync() {
  const { connector, isConnected, address } = useAccount();

  useEffect(() => {
    if (!isConnected || !connector || !address) {
      setWalletClient(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const provider = await connector.getProvider();
        if (cancelled) return;
        setWalletClient({ address: address as `0x${string}`, provider });
      } catch (err) {
        // Provider unavailable — wallet may be locked or disconnected
        if (!cancelled) setWalletClient(null);
      }
    })();

    return () => {
      cancelled = true;
      setWalletClient(null);
    };
  }, [connector, isConnected, address]);

  return null;
}

/* ────────────────────────────
   Provider
──────────────────────────── */

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          coolMode
          modalSize="compact"
          theme={darkTheme({
            accentColor: "hsl(var(--primary))",
            borderRadius: "medium",
          })}
        >
          <ConnectorSync />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

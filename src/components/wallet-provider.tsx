"use client";

import { type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { walletConfig } from "@/lib/wallet/config";

import "@rainbow-me/rainbowkit/styles.css";

/* ────────────────────────────
   Query Client (stable singleton)
──────────────────────────── */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sensible defaults for wallet state
      staleTime: 30_000,
      retry: 2,
    },
  },
});

/* ────────────────────────────
   Provider
──────────────────────────── */

/**
 * Wraps the app with wagmi + RainbowKit + React Query providers.
 *
 * This enables `useAccount`, `useSignMessage`, `useConnectModal`,
 * and other wallet hooks throughout the app.
 */
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
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

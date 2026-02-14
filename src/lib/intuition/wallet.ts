/**
 * Wagmi + RainbowKit Configuration
 *
 * Uses INTUITION_CHAIN from the SDK config — no duplicate chain definition.
 * Supports optional WalletConnect via NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
 */

import { type Transport, http, fallback, createConfig } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

import { INTUITION_CHAIN } from "@/lib/intuition/config";

/* ────────────────────────────
   Chain & Transport
──────────────────────────── */

const chains = [INTUITION_CHAIN] as const;

type ChainId = typeof INTUITION_CHAIN.id;

const rpcUrls = INTUITION_CHAIN.rpcUrls.default.http;
const transports: Record<ChainId, Transport> = {
  [INTUITION_CHAIN.id]: fallback(
    rpcUrls.map((url) =>
      http(url, { timeout: 8_000, retryCount: 2, retryDelay: 250 })
    )
  ),
} as Record<ChainId, Transport>;

/* ────────────────────────────
   Config
──────────────────────────── */

const projectId =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
    : undefined;

/**
 * Wagmi config for wallet connection.
 *
 * With WalletConnect project ID: full experience (mobile QR, WalletConnect bridge).
 * Without: injected wallets (MetaMask, Brave) + Coinbase Wallet only.
 */
export const walletConfig = projectId
  ? getDefaultConfig({
      appName: "Atlas",
      projectId,
      chains,
      transports,
      ssr: true,
    })
  : createConfig({
      chains,
      transports,
      connectors: [injected(), coinbaseWallet({ appName: "Atlas" })],
      ssr: true,
    });

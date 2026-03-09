/**
 * Intuition – Wallet Infrastructure Layer
 *
 * Responsibilities:
 *  - Wagmi configuration
 *  - Transport strategy
 *  - Connector setup
 *  - Safe chain enforcement
 *
 * This file MUST NOT contain protocol logic.
 */

import {
  type Transport,
  http,
  fallback,
  createConfig,
} from "wagmi";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { INTUITION_CHAIN } from "@/lib/intuition/config";

/* ────────────────────────────
   Chain Definition
──────────────────────────── */

const chains = [INTUITION_CHAIN] as const;

type ChainId = typeof INTUITION_CHAIN.id;

/* ────────────────────────────
   Transport Strategy
──────────────────────────── */

const rpcUrls = INTUITION_CHAIN.rpcUrls.default.http;

const transports: Record<ChainId, Transport> = {
  [INTUITION_CHAIN.id]: fallback(
    rpcUrls.map((url) =>
      http(url, {
        timeout: 8_000,
        retryCount: 2,
        retryDelay: 250,
      })
    )
  ),
} as Record<ChainId, Transport>;

/* ────────────────────────────
   Connector Strategy
──────────────────────────── */

const projectId =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
    : undefined;

function buildConnectors() {
  const connectors = [
    injected(),
    coinbaseWallet({ appName: "Atlas" }),
  ];

  if (projectId) {
    connectors.push(
      walletConnect({
        projectId,
      })
    );
  }

  return connectors;
}

/* ────────────────────────────
   Wagmi Config
──────────────────────────── */

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
      connectors: buildConnectors(),
      ssr: true,
    });

/* ────────────────────────────
   Public Helpers
──────────────────────────── */

export function getIntuitionChainId() {
  return INTUITION_CHAIN.id;
}

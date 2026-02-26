/**
 * Intuition SDK Configuration
 *
 * Configuration for connecting to the Intuition chain using the official SDK.
 *
 * Domain config (attestation types, attributes) lives in @/lib/attestations/definitions.ts
 * This file contains SDK-specific config: chain, contracts, environment detection.
 *
 * @see https://docs.intuition.systems/docs/intuition-sdk/installation-and-setup
 */

import {
  intuitionTestnet,
  intuitionMainnet,
  getMultiVaultAddressFromChainId,
} from "@0xintuition/sdk";

/* ────────────────────────────
   Environment Detection
──────────────────────────── */

/**
 * Check if we're in development mode
 * Set NODE_ENV=development to enable
 */
export const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Check if Intuition integration is enabled
 * Set NEXT_PUBLIC_INTUITION_ENABLED=true to enable
 */
export const INTUITION_ENABLED =
  process.env.NEXT_PUBLIC_INTUITION_ENABLED === "true";

/**
 * Check if we should use testnet
 * Defaults to true in development
 */
export const USE_TESTNET =
  process.env.NEXT_PUBLIC_INTUITION_TESTNET === "true" || IS_DEV;

/* ────────────────────────────
   Chain Configuration
──────────────────────────── */

/**
 * Intuition chain configuration from the SDK
 *
 * - Testnet: Chain ID 13579 (for development)
 * - Mainnet: Chain ID 1155 (for production)
 */
export const INTUITION_CHAIN = USE_TESTNET ? intuitionTestnet : intuitionMainnet;

/**
 * MultiVault contract address for the current chain
 * This is the main entry point for creating atoms and triples
 */
export const MULTIVAULT_ADDRESS = getMultiVaultAddressFromChainId(
  INTUITION_CHAIN.id
);

/**
 * Native currency symbol for the current chain (e.g., "tTRUST" on testnet, "TRUST" on mainnet).
 * Derived from the SDK chain config.
 */
export const NATIVE_CURRENCY_SYMBOL = INTUITION_CHAIN.nativeCurrency.symbol;


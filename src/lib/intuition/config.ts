/**
 * Intuition SDK – Infrastructure Configuration
 *
 * Responsible for:
 *  - Environment detection
 *  - Chain selection
 *  - Deterministic contract address resolution
 *
 * Domain config (attestation types, attributes) lives in @/lib/attestations/definitions.ts.
 * This file MUST NOT contain business logic, wallet logic, or attestation logic.
 *
 * @see https://docs.intuition.systems/docs/intuition-sdk/installation-and-setup
 */

import {
  intuitionTestnet,
  intuitionMainnet,
  getMultiVaultAddressFromChainId,
} from "@0xintuition/sdk";

/* ────────────────────────────
   Environment Flags
──────────────────────────── */

export const IS_DEV = process.env.NODE_ENV === "development";

export const INTUITION_ENABLED =
  process.env.NEXT_PUBLIC_INTUITION_ENABLED === "true";

/**
 * Chain selection strategy:
 *
 * Priority order:
 * 1. Explicit NEXT_PUBLIC_INTUITION_TESTNET flag
 * 2. Development fallback
 */
export const USE_TESTNET =
  process.env.NEXT_PUBLIC_INTUITION_TESTNET === "true" || IS_DEV;

/* ────────────────────────────
   Chain Resolution
──────────────────────────── */

/**
 * Returns the active Intuition chain configuration.
 *
 * Never reference intuitionMainnet / intuitionTestnet
 * directly outside this file. Always go through this accessor.
 */
export function getIntuitionChain() {
  return USE_TESTNET ? intuitionTestnet : intuitionMainnet;
}

/**
 * Deterministically resolves the MultiVault deployment
 * for the active chain.
 */
export function getMultiVaultAddress() {
  return getMultiVaultAddressFromChainId(getIntuitionChain().id);
}

/**
 * Returns the native currency symbol (TRUST / tTRUST)
 * from the active chain configuration.
 */
export function getNativeCurrencySymbol() {
  return getIntuitionChain().nativeCurrency.symbol;
}

/* ────────────────────────────
   Explorer URLs
──────────────────────────── */

/**
 * Returns the base block explorer URL for the active Intuition chain.
 * Uses the Blockscout explorer from the SDK chain config.
 */
function getExplorerBaseUrl(): string {
  const chain = getIntuitionChain();
  return chain.blockExplorers?.default.url ?? "https://explorer.intuition.systems";
}

/**
 * Build a block explorer URL for a transaction hash.
 * Returns null if no txHash is provided.
 */
export function getExplorerTxUrl(txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  return `${getExplorerBaseUrl()}/tx/${txHash}`;
}

/* ────────────────────────────
   Convenience Constants
──────────────────────────── */

export const INTUITION_CHAIN = getIntuitionChain();
export const MULTIVAULT_ADDRESS = getMultiVaultAddress();
export const NATIVE_CURRENCY_SYMBOL = getNativeCurrencySymbol();

/** The "I" atom — represents the transaction signer. Used as subject for TRUST triples. */
export const I_ATOM_TERM_ID = "0x7ab197b346d386cd5926dbfeeb85dade42f113c7ed99ff2046a5123bb5cd016b" as `0x${string}`;

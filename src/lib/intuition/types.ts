/**
 * Intuition SDK Types
 *
 * Type definitions for Intuition chain integration.
 *
 * @see https://docs.intuition.systems/docs/intuition-sdk
 */

import type { Address } from "viem";
import type { AttestationType } from "@/lib/attestations/definitions";

/* ────────────────────────────
   Ethereum Provider
──────────────────────────── */

/** Typed injected provider — avoids `(window as any).ethereum` casts. */
export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/* ────────────────────────────
   Batch Mint
──────────────────────────── */

/** A single item in a batch mint request. */
export type BatchMintItem = {
  attestationId: string;
  type: AttestationType;
  toAddress: Address;
  /** Attribute ID for endorsements (SKILL_ENDORSE / TOOL_ENDORSE). */
  attributeId?: string;
  /** Custom deposit in wei. Falls back to protocol minimum if not set. */
  depositAmount?: bigint;
};

/** Result from batch minting on-chain. */
export type BatchMintResult = {
  atomsTxHash: string;
  triplesTxHash: string;
  items: Array<{
    attestationId: string;
    onchainId: string;
  }>;
};

/* ────────────────────────────
   Batch Withdraw
──────────────────────────── */

/** A single item in a batch withdraw request. */
export type BatchWithdrawItem = {
  attestationId: string;
  /** bytes32 termId from the Intuition protocol (stored as `attestation.onchainId`). */
  onchainId: string;
};

/** Result from batch withdrawal on-chain. */
export type BatchWithdrawResult = {
  txHash: string;
  items: Array<{
    attestationId: string;
    onchainId: string;
  }>;
};

/* ────────────────────────────
   Wallet
──────────────────────────── */

/** Connected wallet state. */
export type WalletState = {
  isConnected: boolean;
  address: Address | null;
  chainId: number | null;
};

/* ────────────────────────────
   Errors
──────────────────────────── */

export type IntuitionErrorCode =
  | "WALLET_NOT_CONNECTED"
  | "WRONG_CHAIN"
  | "USER_REJECTED"
  | "INSUFFICIENT_FUNDS"
  | "TRANSACTION_FAILED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class IntuitionError extends Error {
  code: IntuitionErrorCode;

  constructor(code: IntuitionErrorCode, message: string) {
    super(message);
    this.name = "IntuitionError";
    this.code = code;
  }
}

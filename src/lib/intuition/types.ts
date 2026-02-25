/**
 * Intuition SDK Types
 *
 * Type definitions for Intuition chain integration.
 * Supports the Hybrid approach with Users, Skills, and Communities as first-class Atoms.
 *
 * @see https://docs.intuition.systems/docs/intuition-sdk
 */

import type { Address } from "viem";
import type { AttestationType } from "@/lib/attestations/definitions";
import type { AttributeId } from "@/lib/attestations/definitions";

/* ────────────────────────────
   User-to-User Attestation Types
──────────────────────────── */

/**
 * Input for creating a user-to-user attestation onchain
 *
 * Triple structure: [fromUser] [type] [toUser]
 * Example: [Alice] [TRUST] [Bob]
 *
 * Uses AttestationType from @/lib/attestations/definitions which maps to blockchain predicates.
 */
export type CreateAttestationInput = {
  /** Ethereum address of the attestation giver (subject) */
  fromAddress: Address;
  /** Ethereum address of the attestation receiver (object) */
  toAddress: Address;
  /** Type of attestation - maps to a predicate via getPredicateForType() */
  type: AttestationType;
  /** Optional deposit amount for the triple (defaults to contract minDeposit) */
  depositAmount?: bigint;
};

/**
 * Result from creating an attestation onchain
 * Matches the SDK return type from createTripleStatement
 */
export type CreateAttestationResult = {
  /** Transaction hash from the blockchain */
  transactionHash: string;
  /** Term ID of the created triple (from event logs) */
  termId: string;
};

/* ────────────────────────────
   Skill Attestation Types (Hybrid)
──────────────────────────── */

/**
 * Input for creating an attribute attestation onchain
 *
 * Triple structure: [User] [has_attribute] [Attribute]
 * Example: [Alice] [has_attribute] [Engineering]
 *
 * This creates a queryable relationship:
 * - "Who has engineering?" → Find triples where object = engineering atom
 */
export type CreateAttributeAttestationInput = {
  /** Ethereum address of the user claiming the attribute */
  userAddress: Address;
  /** The attribute being claimed (skill or tool) */
  attributeId: AttributeId;
  /** Optional deposit amount for the triple (defaults to contract minDeposit) */
  depositAmount?: bigint;
};

// Legacy alias for backward compatibility
export type CreateSkillAttestationInput = CreateAttributeAttestationInput;

/* ────────────────────────────
   Community-Scoped Attestation Types (Hybrid)
──────────────────────────── */

/**
 * Input for creating a community-scoped attestation onchain
 *
 * Creates two triples:
 * 1. [fromUser] [type] [toUser] → the attestation itself
 * 2. [attestation] [in_community] [community] → the community context
 *
 * This enables queries like:
 * - "Who trusts Bob in Community X?"
 * - "All endorsements within Community Y"
 */
export type CreateCommunityAttestationInput = {
  /** Ethereum address of the attestation giver (subject) */
  fromAddress: Address;
  /** Ethereum address of the attestation receiver (object) */
  toAddress: Address;
  /** Type of attestation - maps to a predicate via getPredicateForType() */
  type: AttestationType;
  /** Community ID to scope this attestation to */
  communityId: string;
  /** Optional deposit amount per triple (defaults to contract minDeposit) */
  depositAmount?: bigint;
};

/**
 * Result from creating a community-scoped attestation
 * Includes both the attestation triple and the context triple
 */
export type CreateCommunityAttestationResult = {
  /** Transaction hash from the final transaction */
  transactionHash: string;
  /** Term ID of the attestation triple */
  attestationTermId: string;
  /** Term ID of the community context triple */
  contextTermId: string;
};

/* ────────────────────────────
   Batch Mint Types
──────────────────────────── */

/** Input for a single item in a batch mint */
export type BatchMintItem = {
  /** Our internal attestation ID (from DB) */
  attestationId: string;
  /** Type of attestation (FOLLOW, TRUST, etc.) */
  type: AttestationType;
  /** Recipient wallet address */
  toAddress: Address;
};

/** Result from batch minting on-chain */
export type BatchMintResult = {
  /** Transaction hash for the atoms creation tx */
  atomsTxHash: string;
  /** Transaction hash for the triples creation tx */
  triplesTxHash: string;
  /** Per-item results mapping attestationId to on-chain termId */
  items: Array<{
    attestationId: string;
    onchainId: string;
  }>;
};

/* ────────────────────────────
   Legacy Types (Deprecated)
──────────────────────────── */

/**
 * Legacy input type for minting attestations
 * @deprecated Use CreateAttestationInput instead
 */
export type MintAttestationInput = {
  /** Our internal attestation ID (from DB) */
  attestationId: string;
  /** User ID of the attestation giver */
  fromUserId: string;
  /** User ID of the attestation receiver */
  toUserId: string;
  /** Type of attestation (e.g., "trust", "skill") */
  type: string;
  /** Optional confidence score */
  confidence?: number | null;
};

/**
 * Legacy result type from minting attestations
 * @deprecated Use CreateAttestationResult instead
 */
export type MintAttestationResult = {
  /** Transaction hash from the blockchain */
  txHash: string;
  /** Onchain attestation ID assigned by Intuition */
  onchainId: string;
  /** Block number where the transaction was included */
  blockNumber: number;
};

/* ────────────────────────────
   Wallet Types
──────────────────────────── */

/**
 * Connected wallet state
 */
export type WalletState = {
  /** Whether a wallet is connected */
  isConnected: boolean;
  /** Connected wallet address (if any) */
  address: Address | null;
  /** Chain ID the wallet is connected to */
  chainId: number | null;
};

/**
 * Supported wallet providers
 */
export type WalletProvider = "metamask" | "walletconnect" | "coinbase";

/* ────────────────────────────
   Transaction Types
──────────────────────────── */

/**
 * Transaction status during minting
 */
export type TransactionStatus =
  | "idle"
  | "preparing"
  | "awaiting_signature"
  | "pending"
  | "confirmed"
  | "failed";

/**
 * Transaction state for UI feedback
 */
export type TransactionState = {
  status: TransactionStatus;
  txHash: string | null;
  error: string | null;
};

/* ────────────────────────────
   Error Types
──────────────────────────── */

/**
 * Intuition SDK error codes
 */
export type IntuitionErrorCode =
  | "WALLET_NOT_CONNECTED"
  | "WRONG_CHAIN"
  | "USER_REJECTED"
  | "INSUFFICIENT_FUNDS"
  | "TRANSACTION_FAILED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

/**
 * Intuition SDK error
 */
export class IntuitionError extends Error {
  code: IntuitionErrorCode;

  constructor(code: IntuitionErrorCode, message: string) {
    super(message);
    this.name = "IntuitionError";
    this.code = code;
  }
}

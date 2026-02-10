/**
 * Intuition SDK Configuration
 *
 * Configuration for connecting to the Intuition chain using the official SDK.
 * Uses a Hybrid approach with first-class Atoms for Users, Skills, and Communities.
 *
 * Domain config (attestation types, attributes) lives in @/lib/attestations/definitions.ts
 * This file contains SDK-specific config: chain, contracts, hybrid predicates.
 *
 * @see https://docs.intuition.systems/docs/intuition-sdk/installation-and-setup
 */

import {
  intuitionTestnet,
  intuitionMainnet,
  getMultiVaultAddressFromChainId,
} from "@0xintuition/sdk";
import { parseEther } from "viem";

/* ────────────────────────────
   Environment Detection
──────────────────────────── */

/**
 * Check if we're in development mode
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
 * Default deposit amount for creating triples
 * This is the minimum amount required to stake on a triple
 */
export const DEFAULT_DEPOSIT_AMOUNT = parseEther("0.0001");

/* ────────────────────────────
   Hybrid Predicates
──────────────────────────── */

/**
 * Hybrid-specific predicate atoms for the SDK
 *
 * User-to-user predicates (FOLLOW, TRUST, etc.) are in @/lib/attestations/definitions.ts
 * Attributes (skills, tools) are in @/lib/attestations/definitions.ts
 *
 * This file only defines predicates for Hybrid approach features:
 * - Attribute possession: [User] [has_attribute] [Attribute]
 * - Community scoping: [Triple] [in_community] [Community]
 */
export const HYBRID_PREDICATES = {
  /** Attribute possession: "User has attribute X" */
  hasAttribute: "atlas:has_attribute",
  /** Community context: "Attestation is within community X" */
  inCommunity: "atlas:in_community",
} as const;

export type HybridPredicateType = keyof typeof HYBRID_PREDICATES;

/* ────────────────────────────
   Community Atoms
──────────────────────────── */

/**
 * Prefix for community atoms
 *
 * Communities are dynamically created atoms based on their ID:
 * - `atlas:community:abc123` for community with ID "abc123"
 *
 * Triple structure for community-scoped attestations:
 * 1. [User] [trusts] [User] → creates attestation triple
 * 2. [Attestation Triple] [in_community] [Community Atom] → adds context
 */
export const COMMUNITY_ATOM_PREFIX = "atlas:community:";

/**
 * Generate a community atom identifier from a community ID
 */
export function getCommunityAtomId(communityId: string): string {
  return `${COMMUNITY_ATOM_PREFIX}${communityId}`;
}

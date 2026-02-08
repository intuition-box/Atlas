/**
 * Intuition SDK Client
 *
 * Client-side SDK wrapper for interacting with the Intuition chain.
 * Uses the official @0xintuition/sdk for atoms, triples, and vault operations.
 *
 * Supports a Hybrid approach with:
 * - Users as Atoms (via createAtomFromEthereumAccount)
 * - Skills as first-class Atoms (via createAtomFromString)
 * - Communities as first-class Atoms (via createAtomFromString)
 * - Relationships as Triples linking atoms
 *
 * @see https://docs.intuition.systems/docs/intuition-sdk/installation-and-setup
 *
 * @example
 * ```tsx
 * import {
 *   connectWallet,
 *   createAttestation,
 *   createSkillAttestation,
 *   createCommunityAttestation,
 * } from "@/lib/intuition/client";
 *
 * // User-to-User attestation (uses AttestationType from config/attestations)
 * await createAttestation({ fromAddress, toAddress, type: "TRUST" });
 *
 * // Skill attestation: [User] [has_skill] [Engineering]
 * await createSkillAttestation({ userAddress, skill: "engineering" });
 *
 * // Community-scoped attestation
 * await createCommunityAttestation({ fromAddress, toAddress, type: "TRUST", communityId });
 * ```
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  type PublicClient,
  type WalletClient,
  type Address,
} from "viem";
import {
  createAtomFromString,
  createAtomFromEthereumAccount,
  createTripleStatement,
  getAtomDetails,
  getTripleDetails,
} from "@0xintuition/sdk";

import {
  type AttestationType,
  getPredicateForType,
} from "@/lib/attestations/definitions";
import {
  type AttributeId,
  getAttributePredicate,
} from "@/lib/attestations/definitions";
import {
  INTUITION_CHAIN,
  MULTIVAULT_ADDRESS,
  INTUITION_ENABLED,
  HYBRID_PREDICATES,
  DEFAULT_DEPOSIT_AMOUNT,
  getCommunityAtomId,
  type HybridPredicateType,
} from "./config";
import type {
  WalletState,
  TransactionState,
  CreateAttestationInput,
  CreateAttestationResult,
  CreateSkillAttestationInput,
  CreateCommunityAttestationInput,
  CreateCommunityAttestationResult,
  IntuitionErrorCode,
} from "./types";
import { IntuitionError } from "./types";

/* ────────────────────────────
   Viem Clients
──────────────────────────── */

/**
 * Public client for read-only operations
 * Can query atom/triple data without a wallet
 */
export const publicClient: PublicClient = createPublicClient({
  chain: INTUITION_CHAIN,
  transport: http(),
});

/**
 * Create a wallet client from the browser's injected provider (MetaMask, etc.)
 * Returns null if no wallet is available (server-side or no extension)
 */
export function createBrowserWalletClient(): WalletClient | null {
  if (typeof window === "undefined") {
    return null;
  }

  const ethereum = (window as Window & { ethereum?: unknown }).ethereum;
  if (!ethereum) {
    return null;
  }

  return createWalletClient({
    chain: INTUITION_CHAIN,
    transport: custom(ethereum as Parameters<typeof custom>[0]),
  });
}

/* ────────────────────────────
   Wallet Connection
──────────────────────────── */

/**
 * Get current wallet state
 */
export async function getWalletState(): Promise<WalletState> {
  if (typeof window === "undefined") {
    return { isConnected: false, address: null, chainId: null };
  }

  const ethereum = (window as Window & { ethereum?: { request: (args: { method: string }) => Promise<unknown> } }).ethereum;
  if (!ethereum) {
    return { isConnected: false, address: null, chainId: null };
  }

  try {
    const accounts = (await ethereum.request({
      method: "eth_accounts",
    })) as string[];

    if (accounts.length === 0) {
      return { isConnected: false, address: null, chainId: null };
    }

    const chainIdHex = (await ethereum.request({
      method: "eth_chainId",
    })) as string;
    const chainId = parseInt(chainIdHex, 16);

    return {
      isConnected: true,
      address: accounts[0] as Address,
      chainId,
    };
  } catch {
    return { isConnected: false, address: null, chainId: null };
  }
}

/**
 * Request wallet connection
 */
export async function connectWallet(): Promise<WalletState> {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError(
      "NETWORK_ERROR",
      "Intuition integration is not enabled"
    );
  }

  if (typeof window === "undefined") {
    throw new IntuitionError(
      "WALLET_NOT_CONNECTED",
      "Cannot connect wallet on server"
    );
  }

  const ethereum = (window as Window & { ethereum?: { request: (args: { method: string }) => Promise<unknown> } }).ethereum;
  if (!ethereum) {
    throw new IntuitionError(
      "WALLET_NOT_CONNECTED",
      "No wallet extension found. Please install MetaMask."
    );
  }

  try {
    const accounts = (await ethereum.request({
      method: "eth_requestAccounts",
    })) as string[];

    const chainIdHex = (await ethereum.request({
      method: "eth_chainId",
    })) as string;
    const chainId = parseInt(chainIdHex, 16);

    return {
      isConnected: true,
      address: accounts[0] as Address,
      chainId,
    };
  } catch (error) {
    if ((error as { code?: number }).code === 4001) {
      throw new IntuitionError("USER_REJECTED", "User rejected wallet connection");
    }
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Failed to connect wallet");
  }
}

/**
 * Disconnect wallet (clear state)
 */
export async function disconnectWallet(): Promise<void> {
  // Most wallets don't have a programmatic disconnect
  // This is mainly for clearing app state
}

/**
 * Switch to the Intuition network
 */
export async function switchToIntuitionNetwork(): Promise<void> {
  if (typeof window === "undefined") {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Cannot switch network on server");
  }

  const ethereum = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!ethereum) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "No wallet extension found");
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${INTUITION_CHAIN.id.toString(16)}` }],
    });
  } catch (error) {
    // Chain not added, try to add it
    if ((error as { code?: number }).code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${INTUITION_CHAIN.id.toString(16)}`,
            chainName: INTUITION_CHAIN.name,
            nativeCurrency: INTUITION_CHAIN.nativeCurrency,
            rpcUrls: [INTUITION_CHAIN.rpcUrls.default.http[0]],
            blockExplorerUrls: INTUITION_CHAIN.blockExplorers
              ? [INTUITION_CHAIN.blockExplorers.default.url]
              : undefined,
          },
        ],
      });
    } else {
      throw new IntuitionError("WRONG_CHAIN", "Failed to switch to Intuition network");
    }
  }
}

/* ────────────────────────────
   Atom Operations
──────────────────────────── */

/**
 * Create an atom from a string (e.g., predicate names, skills)
 * Returns the atom result with termId
 */
export async function createStringAtom(content: string) {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError("NETWORK_ERROR", "Intuition integration is not enabled");
  }

  const walletClient = createBrowserWalletClient();
  if (!walletClient) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Please connect your wallet");
  }

  return createAtomFromString(
    {
      walletClient,
      publicClient,
      address: MULTIVAULT_ADDRESS,
    },
    content
  );
}

/**
 * Create an atom from an Ethereum address (for users)
 * Returns the atom result with termId
 */
export async function createUserAtom(address: Address) {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError("NETWORK_ERROR", "Intuition integration is not enabled");
  }

  const walletClient = createBrowserWalletClient();
  if (!walletClient) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Please connect your wallet");
  }

  return createAtomFromEthereumAccount(
    {
      walletClient,
      publicClient,
      address: MULTIVAULT_ADDRESS,
    },
    address
  );
}

/**
 * Get atom details by hash
 */
export async function getAtom(atomHash: string) {
  return getAtomDetails(atomHash);
}

/* ────────────────────────────
   Triple Operations
──────────────────────────── */

/**
 * Create a triple (subject-predicate-object relationship)
 *
 * SDK API expects arrays for batch support:
 * - args: [[subjects], [predicates], [objects], [deposits]]
 * - value: total transaction value
 *
 * @param subjectTermId - Term ID of the subject atom
 * @param predicateTermId - Term ID of the predicate atom
 * @param objectTermId - Term ID of the object atom
 * @param depositAmount - Deposit amount per triple (defaults to DEFAULT_DEPOSIT_AMOUNT)
 */
export async function createTriple(
  subjectTermId: `0x${string}`,
  predicateTermId: `0x${string}`,
  objectTermId: `0x${string}`,
  depositAmount: bigint = DEFAULT_DEPOSIT_AMOUNT
) {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError("NETWORK_ERROR", "Intuition integration is not enabled");
  }

  const walletClient = createBrowserWalletClient();
  if (!walletClient) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Please connect your wallet");
  }

  return createTripleStatement(
    {
      walletClient,
      publicClient,
      address: MULTIVAULT_ADDRESS,
    },
    {
      args: [
        [subjectTermId],
        [predicateTermId],
        [objectTermId],
        [depositAmount],
      ],
      value: depositAmount,
    }
  );
}

/**
 * Get triple details by hash
 */
export async function getTriple(tripleHash: string) {
  return getTripleDetails(tripleHash);
}

/* ────────────────────────────
   Predicate Atom Cache
──────────────────────────── */

// Cache for attestation predicate term IDs (from config/attestations.ts)
const attestationPredicateCache = new Map<AttestationType, `0x${string}`>();

// Cache for hybrid predicate term IDs (hasAttribute, inCommunity)
const hybridPredicateCache = new Map<HybridPredicateType, `0x${string}`>();

/**
 * Get or create a predicate atom for an attestation type
 * Uses the unified types from config/attestations.ts
 */
export async function getOrCreateAttestationPredicate(
  type: AttestationType
): Promise<`0x${string}`> {
  // Check cache first
  const cached = attestationPredicateCache.get(type);
  if (cached !== undefined) {
    return cached;
  }

  // Create the predicate atom using the unified mapping
  const predicateName = getPredicateForType(type);
  const result = await createStringAtom(predicateName);

  // Cache and return the termId
  const termId = result.state.termId;
  attestationPredicateCache.set(type, termId);
  return termId;
}

/**
 * Get or create a hybrid predicate atom (hasAttribute, inCommunity)
 * These are for Hybrid features, not user-to-user attestations
 */
export async function getOrCreateHybridPredicate(
  type: HybridPredicateType
): Promise<`0x${string}`> {
  // Check cache first
  const cached = hybridPredicateCache.get(type);
  if (cached !== undefined) {
    return cached;
  }

  // Create the predicate atom
  const predicateName = HYBRID_PREDICATES[type];
  const result = await createStringAtom(predicateName);

  // Cache and return the termId
  const termId = result.state.termId;
  hybridPredicateCache.set(type, termId);
  return termId;
}

/* ────────────────────────────
   Skill Atom Operations (Hybrid)
──────────────────────────── */

// Cache for attribute term IDs (created once, reused across all users)
const attributeTermIdCache = new Map<AttributeId, `0x${string}`>();

/**
 * Get or create a skill atom
 *
 * Skills are first-class atoms that can be queried across users:
 * - "Who has engineering skill?" → Find triples where object = engineering atom
 *
 * @param skill - The skill type to get or create
 * @returns Term ID of the skill atom
 */
export async function getOrCreateAttributeAtom(attributeId: AttributeId): Promise<`0x${string}`> {
  // Check cache first
  const cached = attributeTermIdCache.get(attributeId);
  if (cached !== undefined) {
    return cached;
  }

  // Create the attribute atom using the predicate from config
  const attributePredicate = getAttributePredicate(attributeId);
  const result = await createStringAtom(attributePredicate);

  // Cache and return the termId
  const termId = result.state.termId;
  attributeTermIdCache.set(attributeId, termId);
  return termId;
}

// Legacy alias for backward compatibility
export const getOrCreateSkillAtom = getOrCreateAttributeAtom;

/**
 * Create a skill attestation: [User] [has_skill] [Skill]
 *
 * This creates a queryable triple linking a user to a skill atom.
 *
 * @param input - User address and skill type
 * @returns Transaction result with transactionHash and termId
 *
 * @example
 * ```tsx
 * // Attest that Alice has engineering skill
 * const result = await createSkillAttestation({
 *   userAddress: "0xAlice...",
 *   skill: "engineering",
 * });
 * ```
 */
export async function createSkillAttestation(
  input: CreateSkillAttestationInput
): Promise<CreateAttestationResult> {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError("NETWORK_ERROR", "Intuition integration is not enabled");
  }

  const walletClient = createBrowserWalletClient();
  if (!walletClient) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Please connect your wallet");
  }

  // Ensure we're on the correct chain
  const wallet = await getWalletState();
  if (wallet.chainId !== INTUITION_CHAIN.id) {
    throw new IntuitionError(
      "WRONG_CHAIN",
      `Please switch to ${INTUITION_CHAIN.name}`
    );
  }

  const depositAmount = input.depositAmount ?? DEFAULT_DEPOSIT_AMOUNT;

  try {
    // 1. Create or get user atom (subject)
    const userAtom = await createAtomFromEthereumAccount(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      input.userAddress
    );

    // 2. Get or create "has_skill" predicate atom
    const predicateTermId = await getOrCreateHybridPredicate("hasAttribute");

    // 3. Get or create attribute atom (object)
    const attributeTermId = await getOrCreateAttributeAtom(input.attributeId);

    // 4. Create the triple: [User] [has_attribute] [Attribute]
    const triple = await createTripleStatement(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      {
        args: [
          [userAtom.state.termId],
          [predicateTermId],
          [attributeTermId],
          [depositAmount],
        ],
        value: depositAmount,
      }
    );

    return {
      transactionHash: triple.transactionHash,
      termId: extractTermIdFromTripleResult(triple),
    };
  } catch (error) {
    throw mapError(error);
  }
}

/* ────────────────────────────
   Community Atom Operations (Hybrid)
──────────────────────────── */

// Cache for community term IDs (created once per community)
const communityTermIdCache = new Map<string, `0x${string}`>();

/**
 * Get or create a community atom
 *
 * Communities are first-class atoms that can scope attestations:
 * - "Who trusts Bob in Community X?" → Find triples with community context
 *
 * @param communityId - The community ID to get or create atom for
 * @returns Term ID of the community atom
 */
export async function getOrCreateCommunityAtom(communityId: string): Promise<`0x${string}`> {
  // Check cache first
  const cached = communityTermIdCache.get(communityId);
  if (cached !== undefined) {
    return cached;
  }

  // Create the community atom
  const communityAtomId = getCommunityAtomId(communityId);
  const result = await createStringAtom(communityAtomId);

  // Cache and return the termId
  const termId = result.state.termId;
  communityTermIdCache.set(communityId, termId);
  return termId;
}

/**
 * Create a community-scoped attestation
 *
 * Creates two triples:
 * 1. [fromUser] [type] [toUser] → the attestation itself
 * 2. [attestation] [in_community] [community] → the community context
 *
 * @param input - Attestation details with community ID
 * @returns Transaction result with both term IDs
 *
 * @example
 * ```tsx
 * // Create a trust attestation scoped to a community
 * const result = await createCommunityAttestation({
 *   fromAddress: "0xAlice...",
 *   toAddress: "0xBob...",
 *   type: "TRUST",
 *   communityId: "abc123",
 * });
 * ```
 */
export async function createCommunityAttestation(
  input: CreateCommunityAttestationInput
): Promise<CreateCommunityAttestationResult> {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError("NETWORK_ERROR", "Intuition integration is not enabled");
  }

  const walletClient = createBrowserWalletClient();
  if (!walletClient) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Please connect your wallet");
  }

  // Ensure we're on the correct chain
  const wallet = await getWalletState();
  if (wallet.chainId !== INTUITION_CHAIN.id) {
    throw new IntuitionError(
      "WRONG_CHAIN",
      `Please switch to ${INTUITION_CHAIN.name}`
    );
  }

  const depositAmount = input.depositAmount ?? DEFAULT_DEPOSIT_AMOUNT;

  try {
    // 1. Create or get subject atom (from user)
    const subjectAtom = await createAtomFromEthereumAccount(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      input.fromAddress
    );

    // 2. Get or create predicate atom (attestation type from unified config)
    const predicateTermId = await getOrCreateAttestationPredicate(input.type);

    // 3. Create or get object atom (to user)
    const objectAtom = await createAtomFromEthereumAccount(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      input.toAddress
    );

    // 4. Create the attestation triple: [fromUser] [type] [toUser]
    const attestationTriple = await createTripleStatement(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      {
        args: [
          [subjectAtom.state.termId],
          [predicateTermId],
          [objectAtom.state.termId],
          [depositAmount],
        ],
        value: depositAmount,
      }
    );

    const attestationTermId = extractTermIdFromTripleResult(attestationTriple);

    // 5. Get or create "in_community" predicate atom
    const inCommunityPredicateTermId = await getOrCreateHybridPredicate("inCommunity");

    // 6. Get or create community atom
    const communityTermId = await getOrCreateCommunityAtom(input.communityId);

    // 7. Create context triple: [attestation] [in_community] [community]
    // Note: We use the attestation's termId as the subject
    const contextTriple = await createTripleStatement(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      {
        args: [
          [attestationTermId as `0x${string}`],
          [inCommunityPredicateTermId],
          [communityTermId],
          [depositAmount],
        ],
        value: depositAmount,
      }
    );

    return {
      transactionHash: contextTriple.transactionHash,
      attestationTermId,
      contextTermId: extractTermIdFromTripleResult(contextTriple),
    };
  } catch (error) {
    throw mapError(error);
  }
}

/* ────────────────────────────
   User-to-User Attestation Operations
──────────────────────────── */

/**
 * Create a user-to-user attestation as a triple on Intuition
 *
 * Structure: [fromUser] [attestationType] [toUser]
 *
 * @param input - Attestation details
 * @returns Transaction result with transactionHash and termId
 */
export async function createAttestation(
  input: CreateAttestationInput
): Promise<CreateAttestationResult> {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError("NETWORK_ERROR", "Intuition integration is not enabled");
  }

  const walletClient = createBrowserWalletClient();
  if (!walletClient) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Please connect your wallet");
  }

  // Ensure we're on the correct chain
  const wallet = await getWalletState();
  if (wallet.chainId !== INTUITION_CHAIN.id) {
    throw new IntuitionError(
      "WRONG_CHAIN",
      `Please switch to ${INTUITION_CHAIN.name}`
    );
  }

  const depositAmount = input.depositAmount ?? DEFAULT_DEPOSIT_AMOUNT;

  try {
    // 1. Create or get subject atom (from user)
    const subjectAtom = await createAtomFromEthereumAccount(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      input.fromAddress
    );

    // 2. Get or create predicate atom (attestation type from unified config)
    const predicateTermId = await getOrCreateAttestationPredicate(input.type);

    // 3. Create or get object atom (to user)
    const objectAtom = await createAtomFromEthereumAccount(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      input.toAddress
    );

    // 4. Create the triple with correct SDK format
    const triple = await createTripleStatement(
      { walletClient, publicClient, address: MULTIVAULT_ADDRESS },
      {
        args: [
          [subjectAtom.state.termId],
          [predicateTermId],
          [objectAtom.state.termId],
          [depositAmount],
        ],
        value: depositAmount,
      }
    );

    return {
      transactionHash: triple.transactionHash,
      termId: extractTermIdFromTripleResult(triple),
    };
  } catch (error) {
    throw mapError(error);
  }
}

/* ────────────────────────────
   Helper Functions
──────────────────────────── */

/**
 * Extract termId from triple creation result
 * The SDK returns parsed event logs, we need to extract the termId
 */
function extractTermIdFromTripleResult(
  result: Awaited<ReturnType<typeof createTripleStatement>>
): string {
  // The state contains parsed event logs from TripleCreated event
  // For now, return the transaction hash as a placeholder
  // TODO: Extract actual termId from event logs once SDK types are clearer
  return result.transactionHash;
}

/**
 * Map errors to IntuitionError types
 */
function mapError(error: unknown): IntuitionError {
  const message = error instanceof Error ? error.message : "Unknown error";

  if (message.includes("user rejected") || message.includes("User denied")) {
    return new IntuitionError("USER_REJECTED", "Transaction was cancelled");
  }
  if (message.includes("insufficient funds")) {
    return new IntuitionError("INSUFFICIENT_FUNDS", "Insufficient funds for transaction");
  }

  return new IntuitionError("TRANSACTION_FAILED", message);
}

/* ────────────────────────────
   Transaction State Helpers
──────────────────────────── */

/**
 * Create initial transaction state
 */
export function createTransactionState(): TransactionState {
  return {
    status: "idle",
    txHash: null,
    error: null,
  };
}

/**
 * Get user-friendly error message from Intuition error code
 */
export function getErrorMessage(code: IntuitionErrorCode): string {
  switch (code) {
    case "WALLET_NOT_CONNECTED":
      return "Please connect your wallet to continue";
    case "WRONG_CHAIN":
      return "Please switch to the Intuition network";
    case "USER_REJECTED":
      return "Transaction was cancelled";
    case "INSUFFICIENT_FUNDS":
      return "Insufficient funds for transaction";
    case "TRANSACTION_FAILED":
      return "Transaction failed - please try again";
    case "NETWORK_ERROR":
      return "Network error - please check your connection";
    default:
      return "An unexpected error occurred";
  }
}

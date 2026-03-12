/**
 * Intuition Integration – Client
 *
 * Public Surface:
 *  - batchCreateAttestations — batch-mint attestation triples
 *  - getWalletState — read current wallet connection state
 *
 * Internal Layers:
 *  - provider — typed injected wallet access
 *  - clients — viem public/wallet client factories
 *  - contracts — SDK config builders + cached reads
 *  - atoms — atom resolution and creation
 *  - attestations — batch triple creation
 *  - errors — typed error mapping
 *
 * @see https://docs.intuition.systems/docs/intuition-sdk
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  getAddress,
  toHex,
  formatEther,
  type PublicClient,
  type WalletClient,
  type Address,
} from "viem";

import {
  createAtomFromString,
  createAtomFromEthereumAccount,
  batchCreateAtomsFromEthereumAccounts,
  findAtomIds,
  pinThing,
  multiVaultCreateTriples,
  multiVaultGetTripleCost,
  multiVaultGetGeneralConfig,
  multiVaultIsTermCreated,
  calculateAtomId,
  eventParseTripleCreated,
  type WriteConfig,
} from "@0xintuition/sdk";

import {
  type AttestationType,
  type AttributeId,
  getPredicateForType,
  getPredicateThingData,
  getAttributeThingData,
  isEndorsementType,
} from "@/lib/attestations/definitions";

import {
  INTUITION_CHAIN,
  MULTIVAULT_ADDRESS,
  INTUITION_ENABLED,
  NATIVE_CURRENCY_SYMBOL,
} from "./config";

import type {
  WalletState,
  BatchMintItem,
  BatchMintResult,
  EthereumProvider,
} from "./types";

import { IntuitionError } from "./types";

const LOG = "[intuition]";

/* ════════════════════════════════════════════════
   LAYER: provider
════════════════════════════════════════════════ */

/** Get the injected Ethereum provider, or null if unavailable. */
function getProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
}

/* ════════════════════════════════════════════════
   LAYER: clients
════════════════════════════════════════════════ */

const publicClient: PublicClient = createPublicClient({
  chain: INTUITION_CHAIN,
  transport: http(INTUITION_CHAIN.rpcUrls.default.http[0]),
});

/**
 * Create a wallet client from the browser's injected provider.
 * Returns null if no wallet is available.
 */
async function createBrowserWalletClient(): Promise<WalletClient | null> {
  const ethereum = getProvider();
  if (!ethereum) return null;

  const accounts = (await ethereum.request({ method: "eth_accounts" })) as Address[];
  if (accounts.length === 0) return null;

  return createWalletClient({
    account: accounts[0],
    chain: INTUITION_CHAIN,
    transport: custom(ethereum as Parameters<typeof custom>[0]),
  });
}

/** Require a connected wallet client — throws if unavailable. */
async function requireWalletClient(): Promise<WalletClient> {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError("NETWORK_ERROR", "Intuition integration is not enabled");
  }

  const walletClient = await createBrowserWalletClient();
  if (!walletClient) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "Please connect your wallet");
  }

  return walletClient;
}

/* ════════════════════════════════════════════════
   LAYER: contracts
════════════════════════════════════════════════ */

/** Read-only config (no wallet required). */
const readConfig: Pick<WriteConfig, "publicClient" | "address"> = {
  publicClient,
  address: MULTIVAULT_ADDRESS,
};

/**
 * Build a write config from a wallet client.
 *
 * The `as Parameters<...>[0]` cast is required because the SDK's WriteConfig
 * expects a narrower WalletClient variant than viem's generic type.
 */
const buildWriteConfig = (walletClient: WalletClient): WriteConfig => ({
  publicClient,
  walletClient: walletClient as Parameters<typeof multiVaultCreateTriples>[0]["walletClient"],
  address: MULTIVAULT_ADDRESS,
});

let cachedMinDeposit: bigint | null = null;

/** Fetch the minimum deposit from the MultiVault contract (cached per page load). */
async function getMinDeposit(): Promise<bigint> {
  if (cachedMinDeposit !== null) return cachedMinDeposit;

  const config = await multiVaultGetGeneralConfig(readConfig);
  cachedMinDeposit = config.minDeposit;
  return cachedMinDeposit;
}

/** Fetch per-triple cost (base cost + min deposit). */
async function getTripleCost(): Promise<bigint> {
  const [minDeposit, baseCost] = await Promise.all([
    getMinDeposit(),
    multiVaultGetTripleCost(readConfig),
  ]);
  return baseCost + minDeposit;
}

/* ════════════════════════════════════════════════
   LAYER: chain enforcement
════════════════════════════════════════════════ */

/**
 * Ensure the injected provider is on the Intuition chain.
 * Auto-adds the chain if unknown to the wallet.
 */
async function ensureCorrectChain(): Promise<void> {
  const wallet = await getWalletState();
  if (wallet.chainId === INTUITION_CHAIN.id) return;

  const ethereum = getProvider();
  if (!ethereum) {
    throw new IntuitionError("WALLET_NOT_CONNECTED", "No wallet extension found");
  }

  const hexChainId = `0x${INTUITION_CHAIN.id.toString(16)}`;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (error) {
    // 4902 = chain not added to wallet — add it
    if ((error as { code?: number }).code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexChainId,
          chainName: INTUITION_CHAIN.name,
          nativeCurrency: INTUITION_CHAIN.nativeCurrency,
          rpcUrls: [INTUITION_CHAIN.rpcUrls.default.http[0]],
          blockExplorerUrls: INTUITION_CHAIN.blockExplorers
            ? [INTUITION_CHAIN.blockExplorers.default.url]
            : undefined,
        }],
      });
    } else {
      throw new IntuitionError("WRONG_CHAIN", `Please switch to ${INTUITION_CHAIN.name}`);
    }
  }
}

/* ════════════════════════════════════════════════
   LAYER: atoms
════════════════════════════════════════════════ */

/**
 * Get or create a string atom (predicates, skills, etc.).
 *
 * 1. Compute termId deterministically via calculateAtomId
 * 2. Check on-chain existence via multiVaultIsTermCreated
 * 3. If missing, create via createAtomFromString (1 wallet signature)
 */
async function createStringAtom(content: string) {
  const atomData = toHex(content);
  const termId = calculateAtomId(atomData);

  const exists = await multiVaultIsTermCreated(readConfig, { args: [termId] });
  if (exists) {
    return { state: { termId } };
  }

  const walletClient = await requireWalletClient();
  return createAtomFromString(buildWriteConfig(walletClient), content);
}

/** Cache predicate termIds to avoid redundant lookups. */
const predicateCache = new Map<AttestationType, `0x${string}`>();

/**
 * Get or create a predicate atom for an attestation type (beautiful atom).
 *
 * Predicates are minted as schema.org Thing atoms with name + description
 * (no image — they're administrative). Falls back to legacy string atom
 * if IPFS pinning fails.
 */
async function getOrCreatePredicate(type: AttestationType): Promise<`0x${string}`> {
  const cached = predicateCache.get(type);
  if (cached) return cached;

  // Try beautiful atom first
  const thingData = getPredicateThingData(type);
  const uri = await pinThing(thingData);

  if (uri) {
    const atomData = toHex(uri);
    const termId = calculateAtomId(atomData);

    const exists = await multiVaultIsTermCreated(readConfig, { args: [termId] });
    if (exists) {
      console.log(LOG, `Predicate Thing atom "${thingData.name}" already exists:`, termId);
      predicateCache.set(type, termId);
      return termId;
    }

    // Create on-chain using IPFS URI as atom data
    console.log(LOG, `Creating predicate Thing atom "${thingData.name}" (uri: ${uri})`);
    const walletClient = await requireWalletClient();
    const result = await createAtomFromString(buildWriteConfig(walletClient), uri);
    predicateCache.set(type, result.state.termId);
    return result.state.termId;
  }

  // Fallback: legacy string atom if pinning fails
  console.warn(LOG, `IPFS pin failed for predicate "${thingData.name}", falling back to string atom`);
  const result = await createStringAtom(getPredicateForType(type));
  predicateCache.set(type, result.state.termId);
  return result.state.termId;
}

/**
 * Resolve existing atom termIds from the Intuition indexer.
 *
 * Queries multiple format variants (raw, lowercase, hex-encoded)
 * to handle indexer format differences. Returns a lowercase-keyed map.
 */
async function resolveExistingAtoms(
  dataItems: string[],
): Promise<Map<string, `0x${string}`>> {
  const result = new Map<string, `0x${string}`>();
  if (dataItems.length === 0) return result;

  const variants = new Set<string>();
  for (const item of dataItems) {
    variants.add(item);
    variants.add(item.toLowerCase());
    variants.add(toHex(item));
  }

  try {
    const atoms = await findAtomIds(Array.from(variants));
    for (const atom of atoms) {
      result.set(atom.data.toLowerCase(), atom.term_id as `0x${string}`);

      // Decode hex back to string for matching
      if (atom.data.startsWith("0x")) {
        try {
          const decoded = Buffer.from(atom.data.slice(2), "hex").toString("utf8");
          result.set(decoded.toLowerCase(), atom.term_id as `0x${string}`);
        } catch {
          // Not valid utf8 — skip
        }
      }
    }
  } catch {
    // Indexer unavailable — will fall back to on-chain creation
  }

  return result;
}

/* ════════════════════════════════════════════════
   LAYER: thing atoms (beautiful atoms)
════════════════════════════════════════════════ */

/** Cache attribute termIds to avoid redundant IPFS pins + on-chain lookups. */
const attributeAtomCache = new Map<string, `0x${string}`>();

/**
 * Get or create a "beautiful" Thing atom on Intuition.
 *
 * Flow: pin JSON-LD to IPFS → check on-chain existence → create if missing.
 * IPFS pinning is idempotent (same content = same CID), so re-pinning is safe.
 *
 * @param attributeId - Attribute key from ATTRIBUTES (used for caching)
 * @param config - Write config (only needed if atom must be created)
 */
async function getOrCreateThingAtom(
  attributeId: string,
  config: WriteConfig,
): Promise<`0x${string}`> {
  const cached = attributeAtomCache.get(attributeId);
  if (cached) return cached;

  const thingData = getAttributeThingData(attributeId as AttributeId);

  // Pin metadata to IPFS → deterministic CID for identical content
  const uri = await pinThing(thingData);
  if (!uri) {
    throw new IntuitionError("TRANSACTION_FAILED", `Failed to pin Thing atom for "${thingData.name}" to IPFS`);
  }

  // Calculate termId from the IPFS URI (same as SDK does internally)
  const atomData = toHex(uri);
  const termId = calculateAtomId(atomData);

  // Check if this atom already exists on-chain
  const exists = await multiVaultIsTermCreated(readConfig, { args: [termId] });
  if (exists) {
    console.log(LOG, `Thing atom "${thingData.name}" already exists:`, termId);
    attributeAtomCache.set(attributeId, termId);
    return termId;
  }

  // Create the atom on-chain using the IPFS URI as data
  console.log(LOG, `Creating Thing atom "${thingData.name}" (uri: ${uri})`);
  const result = await createAtomFromString(config, uri);
  attributeAtomCache.set(attributeId, result.state.termId);
  return result.state.termId;
}

/* ════════════════════════════════════════════════
   LAYER: attestations
════════════════════════════════════════════════ */

/**
 * Batch-create attestation triples on Intuition.
 *
 * Minimizes wallet signatures:
 * 1. Query indexer for existing atoms (0 signatures)
 * 2. Batch-create missing address atoms (0–1 signature)
 * 3. Create missing predicate atoms (0–1 signature each, rare)
 * 4. Batch-create all triples (1 signature)
 *
 * Best case: 1 wallet signature. Typical: 1–2.
 */
export async function batchCreateAttestations(
  fromAddress: Address,
  items: BatchMintItem[],
): Promise<BatchMintResult> {
  console.log(LOG, "START —", { fromAddress, count: items.length, chain: INTUITION_CHAIN.name });

  if (items.length === 0) {
    throw new IntuitionError("TRANSACTION_FAILED", "No items to mint");
  }

  const walletClient = await requireWalletClient();
  await ensureCorrectChain();

  const config = buildWriteConfig(walletClient);

  try {
    // ── Step 1: Collect all needed atom data ──
    const uniqueAddresses = Array.from(
      new Set([fromAddress, ...items.map((i) => i.toAddress)]),
    ).map((a) => getAddress(a));

    const uniqueTypes = Array.from(new Set(items.map((i) => i.type)));
    const predicateStrings = uniqueTypes.map((t) => getPredicateForType(t));

    // ── Step 2: Query indexer for existing atoms (0 signatures) ──
    const known = await resolveExistingAtoms([...uniqueAddresses, ...predicateStrings]);
    console.log(LOG, "Step 2 — known atoms:", known.size);

    // ── Step 3: Create missing address atoms (0–1 signature) ──
    const missingAddresses = uniqueAddresses.filter(
      (addr) => !known.has(addr.toLowerCase()),
    );

    let atomsTxHash: string | null = null;

    if (missingAddresses.length > 0) {
      console.log(LOG, "Step 3 — creating", missingAddresses.length, "address atoms");

      try {
        const atomsResult = await batchCreateAtomsFromEthereumAccounts(config, missingAddresses);
        atomsTxHash = atomsResult.transactionHash;

        missingAddresses.forEach((addr, i) => {
          known.set(addr.toLowerCase(), atomsResult.state[i].termId);
        });
      } catch (error) {
        // Batch failed — fall back to one-by-one (handles AtomExists gracefully)
        if (isAtomExistsError(error)) {
          console.log(LOG, "Step 3 — AtomExists in batch, falling back to one-by-one");
          for (const addr of missingAddresses) {
            try {
              const result = await createAtomFromEthereumAccount(config, addr);
              known.set(addr.toLowerCase(), result.state.termId);
            } catch (innerError) {
              if (isAtomExistsError(innerError)) {
                // Atom already exists on-chain — compute its termId deterministically
                const termId = calculateAtomId(toHex(getAddress(addr)));
                known.set(addr.toLowerCase(), termId);
              } else {
                throw innerError;
              }
            }
          }
        } else {
          throw error;
        }
      }
    }

    // ── Step 4: Resolve predicate atoms ──
    const predicateTermIds = new Map<AttestationType, `0x${string}`>();

    for (let i = 0; i < uniqueTypes.length; i++) {
      const type = uniqueTypes[i];
      const existing = known.get(predicateStrings[i].toLowerCase());

      if (existing) {
        predicateTermIds.set(type, existing);
        predicateCache.set(type, existing);
      } else {
        const termId = await getOrCreatePredicate(type);
        predicateTermIds.set(type, termId);
      }
    }

    // ── Step 4b: Resolve attribute atoms for endorsements (beautiful atoms) ──
    const attributeTermIds = new Map<string, `0x${string}`>();
    const uniqueAttributeIds = Array.from(
      new Set(items.filter((i) => i.attributeId).map((i) => i.attributeId!)),
    );

    if (uniqueAttributeIds.length > 0) {
      console.log(LOG, "Step 4b — resolving", uniqueAttributeIds.length, "attribute Thing atoms");
      for (const attrId of uniqueAttributeIds) {
        try {
          const termId = await getOrCreateThingAtom(attrId, config);
          attributeTermIds.set(attrId, termId);
        } catch (error) {
          if (isAtomExistsError(error)) {
            // Atom exists but we couldn't resolve termId earlier — pin to get URI and compute
            const thingData = getAttributeThingData(attrId as AttributeId);
            const uri = await pinThing(thingData);
            if (uri) {
              const termId = calculateAtomId(toHex(uri));
              attributeTermIds.set(attrId, termId);
              attributeAtomCache.set(attrId, termId);
            }
          } else {
            throw error;
          }
        }
      }
    }

    // ── Step 5: Build parallel arrays + pre-flight balance check ──
    const fromTermId = known.get(fromAddress.toLowerCase())!;
    const assetPerTriple = await getTripleCost();
    const totalValue = assetPerTriple * BigInt(items.length);

    const subjectIds: `0x${string}`[] = [];
    const predicateIds: `0x${string}`[] = [];
    const objectIds: `0x${string}`[] = [];
    const deposits: bigint[] = [];

    for (const item of items) {
      const isEndorsement = isEndorsementType(item.type) && item.attributeId;

      if (isEndorsement) {
        // Endorsement triple: [toUser] [is_skilled_in] [attribute]
        // Semantics: "toUser is skilled in Engineering", staked by fromUser
        const toTermId = known.get(item.toAddress.toLowerCase())!;
        const attrTermId = attributeTermIds.get(item.attributeId!);

        if (!attrTermId) {
          console.warn(LOG, `Skipping endorsement — no atom for attribute "${item.attributeId}"`);
          // Fall back to legacy triple structure
          subjectIds.push(fromTermId);
          predicateIds.push(predicateTermIds.get(item.type)!);
          objectIds.push(toTermId);
        } else {
          subjectIds.push(toTermId);
          predicateIds.push(predicateTermIds.get(item.type)!);
          objectIds.push(attrTermId);
        }
      } else {
        // Network attestation: [fromUser] [predicate] [toUser]
        subjectIds.push(fromTermId);
        predicateIds.push(predicateTermIds.get(item.type)!);
        objectIds.push(known.get(item.toAddress.toLowerCase())!);
      }

      deposits.push(assetPerTriple);
    }

    const balance = await publicClient.getBalance({ address: fromAddress });

    if (balance < totalValue) {
      throw new IntuitionError(
        "INSUFFICIENT_FUNDS",
        `Need ${formatEther(totalValue)} ${NATIVE_CURRENCY_SYMBOL} to publish ${items.length} attestation${items.length !== 1 ? "s" : ""} but wallet only has ${formatEther(balance)} ${NATIVE_CURRENCY_SYMBOL}. (${formatEther(assetPerTriple)} per triple)`,
      );
    }

    // ── Step 6: Batch-create triples (1 signature) ──
    console.log(LOG, "Step 6 — creating", items.length, "triples");

    let triplesTxHash: `0x${string}` | null = null;
    const skippedIndices = new Set<number>();

    try {
      triplesTxHash = await multiVaultCreateTriples(config, {
        args: [subjectIds, predicateIds, objectIds, deposits],
        value: totalValue,
      });
    } catch (error) {
      if (!isTripleExistsError(error)) throw error;

      // Batch failed because some triples already exist on-chain.
      // Fall back to one-by-one — viem simulates before prompting,
      // so existing triples fail silently (no wallet popup).
      console.log(LOG, "Step 6 — TripleExists in batch, falling back to one-by-one");

      for (let i = 0; i < subjectIds.length; i++) {
        try {
          const hash = await multiVaultCreateTriples(config, {
            args: [[subjectIds[i]], [predicateIds[i]], [objectIds[i]], [deposits[i]]],
            value: deposits[i],
          });
          triplesTxHash = hash;
        } catch (innerError) {
          if (isTripleExistsError(innerError)) {
            console.log(LOG, `  Triple ${i} already exists, skipping`);
            skippedIndices.add(i);
          } else {
            throw innerError;
          }
        }
      }
    }

    // ── Step 7: Parse events + map results ──
    let tripleEvents: Awaited<ReturnType<typeof eventParseTripleCreated>> = [];
    if (triplesTxHash) {
      tripleEvents = await eventParseTripleCreated(publicClient, triplesTxHash);
    }

    let eventIdx = 0;
    const resultItems = items.map((item, i) => {
      if (skippedIndices.has(i)) {
        // Triple already existed on-chain — mark as minted with no new tx
        return { attestationId: item.attestationId, onchainId: "existing" };
      }
      const event = tripleEvents[eventIdx++];
      return {
        attestationId: item.attestationId,
        onchainId: event?.args?.termId ?? triplesTxHash ?? "unknown",
      };
    });

    const finalTxHash = triplesTxHash ?? "existing";
    console.log(LOG, "DONE ✓ —", {
      atomsTxHash,
      triplesTxHash: finalTxHash,
      created: items.length - skippedIndices.size,
      skipped: skippedIndices.size,
    });

    return {
      atomsTxHash: atomsTxHash ?? finalTxHash,
      triplesTxHash: finalTxHash,
      items: resultItems,
    };
  } catch (error) {
    console.error(LOG, "ERROR ✗ —", error);
    throw mapError(error);
  }
}

/* ════════════════════════════════════════════════
   LAYER: wallet state
════════════════════════════════════════════════ */

/** Get current wallet state (connection + chain). */
export async function getWalletState(): Promise<WalletState> {
  const ethereum = getProvider();
  if (!ethereum) {
    return { isConnected: false, address: null, chainId: null };
  }

  try {
    const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
    if (accounts.length === 0) {
      return { isConnected: false, address: null, chainId: null };
    }

    const chainIdHex = (await ethereum.request({ method: "eth_chainId" })) as string;
    return {
      isConnected: true,
      address: accounts[0] as Address,
      chainId: parseInt(chainIdHex, 16),
    };
  } catch {
    return { isConnected: false, address: null, chainId: null };
  }
}

/* ════════════════════════════════════════════════
   LAYER: errors
════════════════════════════════════════════════ */

/** Check if an error is the MultiVault_AtomExists contract revert. */
function isAtomExistsError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("MultiVault_AtomExists");
}

/** Check if an error is the MultiVault_TripleExists contract revert. */
function isTripleExistsError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("MultiVault_TripleExists");
}

/** Map raw errors to typed IntuitionError. */
function mapError(error: unknown): IntuitionError {
  if (error instanceof IntuitionError) return error;

  const message = error instanceof Error ? error.message : "Unknown error";

  if (message.includes("user rejected") || message.includes("User denied")) {
    return new IntuitionError("USER_REJECTED", "Transaction was cancelled");
  }

  if (message.includes("insufficient funds") || message.includes("InsufficientBalance")) {
    return new IntuitionError(
      "INSUFFICIENT_FUNDS",
      `Insufficient ${NATIVE_CURRENCY_SYMBOL} balance — top up your wallet on ${INTUITION_CHAIN.name} and try again.`,
    );
  }

  if (isTripleExistsError(error)) {
    return new IntuitionError(
      "TRANSACTION_FAILED",
      "Some attestations already exist on-chain — they may have been created in a previous attempt.",
    );
  }

  if (isRpcError(message)) {
    return new IntuitionError("NETWORK_ERROR", "Network error — please try again");
  }

  return new IntuitionError("TRANSACTION_FAILED", message);
}

/**
 * Check for transient RPC / network errors.
 *
 * Matches specific transport-level failures, NOT contract errors
 * that happen to contain generic words like "network".
 */
function isRpcError(message: string): boolean {
  const lower = message.toLowerCase();
  const patterns = [
    "request timeout",
    "fetch failed",
    "econnrefused",
    "econnreset",
    "enotfound",
    "socket hang up",
    "503 service unavailable",
    "502 bad gateway",
    "504 gateway timeout",
  ];
  return patterns.some((p) => lower.includes(p));
}

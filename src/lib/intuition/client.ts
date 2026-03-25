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
  redeem,
  type WriteConfig,
} from "@0xintuition/sdk";

import {
  MultiVaultAbi,
  multiVaultMaxRedeem,
  multiVaultDepositBatch,
} from "@0xintuition/protocol";

import {
  type AttestationType,
  type AttributeId,
  getPredicateForType,
  getPredicateThingData,
  getAttributeThingData,
  getHardcodedTermId,
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
  BatchWithdrawItem,
  BatchWithdrawResult,
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
let cachedDefaultCurveId: bigint | null = null;

/** Fetch the minimum deposit from the MultiVault contract (cached per page load). */
async function getMinDeposit(): Promise<bigint> {
  if (cachedMinDeposit !== null) return cachedMinDeposit;

  const config = await multiVaultGetGeneralConfig(readConfig);
  cachedMinDeposit = config.minDeposit;
  return cachedMinDeposit;
}

/** Get the default curve ID used by createTriples (cached per page load). */
async function getDefaultCurveId(): Promise<bigint> {
  if (cachedDefaultCurveId !== null) return cachedDefaultCurveId;

  const [, defaultCurveId] = await publicClient.readContract({
    address: MULTIVAULT_ADDRESS,
    abi: MultiVaultAbi,
    functionName: "bondingCurveConfig",
  });
  cachedDefaultCurveId = defaultCurveId;
  return cachedDefaultCurveId;
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

  // Check for hardcoded ecosystem atom term_id (0 transactions)
  const hardcoded = getHardcodedTermId(type);
  if (hardcoded) {
    console.log(LOG, `Using hardcoded predicate "${type}":`, hardcoded);
    predicateCache.set(type, hardcoded);
    return hardcoded;
  }

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
  console.log(LOG, "Items —", items.map((i) => ({ id: i.attestationId, stance: i.stance, deposit: i.depositAmount?.toString() })));

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

    // ── Step 2: Query indexer for existing address atoms (0 signatures) ──
    // Note: predicates are resolved separately via getOrCreatePredicate (Step 4)
    // to ensure they're always beautiful Thing atoms, not legacy string atoms.
    const known = await resolveExistingAtoms(uniqueAddresses);
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

    // ── Step 4: Resolve predicate atoms (always use beautiful Thing atoms) ──
    // Always go through getOrCreatePredicate to ensure predicates are Thing atoms
    // with IPFS-pinned metadata (name, description, url). This avoids reusing
    // legacy string atoms from the indexer that the portal can't render.
    const predicateTermIds = new Map<AttestationType, `0x${string}`>();

    for (const type of uniqueTypes) {
      const termId = await getOrCreatePredicate(type);
      predicateTermIds.set(type, termId);
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
    const minTripleCost = await getTripleCost();
    const curveId = await getDefaultCurveId();
    console.log(LOG, "Step 5 — defaultCurveId:", curveId.toString());

    // ── Step 5: Build parallel arrays + pre-flight balance check ──
    // ALL items go through createTriples to ensure triples exist on-chain.
    // For "against" items, we use the minimum deposit (unavoidable — createTriples
    // auto-deposits into the "for" vault), then immediately redeem it and deposit
    // into the counter vault in Step 6c.
    const subjectIds: `0x${string}`[] = [];
    const predicateIds: `0x${string}`[] = [];
    const objectIds: `0x${string}`[] = [];
    const deposits: bigint[] = [];

    const againstIndices: number[] = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]!;
      const isEndorsement = isEndorsementType(item.type) && item.attributeId;

      if (isEndorsement) {
        const toTermId = known.get(item.toAddress.toLowerCase())!;
        const attrTermId = attributeTermIds.get(item.attributeId!);

        if (!attrTermId) {
          console.warn(LOG, `Skipping endorsement — no atom for attribute "${item.attributeId}"`);
          subjectIds.push(fromTermId);
          predicateIds.push(predicateTermIds.get(item.type)!);
          objectIds.push(toTermId);
        } else {
          subjectIds.push(toTermId);
          predicateIds.push(predicateTermIds.get(item.type)!);
          objectIds.push(attrTermId);
        }
      } else {
        subjectIds.push(fromTermId);
        predicateIds.push(predicateTermIds.get(item.type)!);
        objectIds.push(known.get(item.toAddress.toLowerCase())!);
      }

      if (item.stance === "against") {
        // createTriples uses minimum deposit (will be redeemed in Step 6c)
        deposits.push(minTripleCost);
        againstIndices.push(idx);
      } else {
        const deposit = item.depositAmount && item.depositAmount >= minTripleCost
          ? item.depositAmount
          : minTripleCost;
        deposits.push(deposit);
      }
    }

    // Total = createTriples cost + oppose counter deposits (against items pay twice:
    // once for triple creation min deposit, once for their actual oppose stake)
    const createTriplesTotal = deposits.reduce((sum, d) => sum + d, BigInt(0));
    let againstDepositTotal = BigInt(0);
    for (const i of againstIndices) {
      const item = items[i]!;
      const deposit = item.depositAmount && item.depositAmount >= minTripleCost
        ? item.depositAmount
        : minTripleCost;
      againstDepositTotal += deposit;
    }
    const totalValue = createTriplesTotal + againstDepositTotal;

    const balance = await publicClient.getBalance({ address: fromAddress });
    console.log(LOG, "Step 5 — balance check:", {
      balance: formatEther(balance),
      totalValue: formatEther(totalValue),
      forItems: items.length - againstIndices.length,
      againstItems: againstIndices.length,
    });

    if (balance < totalValue) {
      throw new IntuitionError(
        "INSUFFICIENT_FUNDS",
        `Need ${formatEther(totalValue)} ${NATIVE_CURRENCY_SYMBOL} to publish ${items.length} attestation${items.length !== 1 ? "s" : ""} but wallet only has ${formatEther(balance)} ${NATIVE_CURRENCY_SYMBOL}.`,
      );
    }

    // ── Step 6: Batch-create ALL triples (1 signature) ──
    // Both "for" and "against" items go here. "Against" items use the minimum
    // deposit which gets redeemed in Step 6c before depositing into the counter vault.
    console.log(LOG, "Step 6 — creating", items.length, "triples");

    let triplesTxHash: `0x${string}` | null = null;
    const existingIndices = new Set<number>();

    try {
      triplesTxHash = await multiVaultCreateTriples(config, {
        args: [subjectIds, predicateIds, objectIds, deposits],
        value: createTriplesTotal,
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
              args: [[subjectIds[i]!], [predicateIds[i]!], [objectIds[i]!], [deposits[i]!]],
              value: deposits[i]!,
            });
            triplesTxHash = hash;
          } catch (innerError) {
            if (isTripleExistsError(innerError)) {
              console.log(LOG, `  Triple ${i} already exists on-chain`);
              existingIndices.add(i);
            } else {
              throw innerError;
            }
          }
        }
      }

    // ── Step 6b: Deposit into existing "for" triples (1 signature) ──
    // Only "for" items that already existed need an extra deposit.
    // "Against" items that already existed are handled in Step 6c.
    const existingTermIds = new Map<number, string>();

    if (existingIndices.size > 0) {
      console.log(LOG, "Step 6b — processing", existingIndices.size, "existing triples");

      const forDepositTermIds: `0x${string}`[] = [];
      const forDepositCurveIds: bigint[] = [];
      const forDepositAssets: bigint[] = [];
      const forDepositMinShares: bigint[] = [];

      for (const i of existingIndices) {
        try {
          const termId = await publicClient.readContract({
            address: MULTIVAULT_ADDRESS,
            abi: MultiVaultAbi,
            functionName: "calculateTripleId",
            args: [subjectIds[i]!, predicateIds[i]!, objectIds[i]!],
          });
          existingTermIds.set(i, termId);
          console.log(LOG, `  Triple ${i} → termId: ${termId}`);

          // Only deposit for "for" items — "against" handled in Step 6c
          if (items[i]?.stance !== "against") {
            forDepositTermIds.push(termId as `0x${string}`);
            forDepositCurveIds.push(curveId);
            forDepositAssets.push(deposits[i]!);
            forDepositMinShares.push(BigInt(0));
          }
        } catch (err) {
          console.warn(LOG, `  Triple ${i} — failed to calculate termId:`, err);
        }
      }

      if (forDepositTermIds.length > 0) {
        const depositValue = forDepositAssets.reduce((sum, a) => sum + a, BigInt(0));
        const depositTxHash = await multiVaultDepositBatch(config, {
          args: [fromAddress, forDepositTermIds, forDepositCurveIds, forDepositAssets, forDepositMinShares],
          value: depositValue,
        });
        if (!triplesTxHash) triplesTxHash = depositTxHash;
        console.log(LOG, "Step 6b — deposited into", forDepositTermIds.length, "existing triples (for), tx:", depositTxHash);
      }
    }

    // ── Step 6c: Oppose — redeem "for" position + deposit into counter vault ──
    // For "against" items, createTriples deposited the minimum into the "for" vault.
    // The protocol forbids holding positions on both sides (HasCounterStake),
    // so we must redeem the "for" position first, then deposit into the counter vault.
    //
    // For "against" items on existing triples (no "for" position from createTriples),
    // we skip the redeem and go straight to the counter deposit.
    const counterTermIds = new Map<number, string>();

    if (againstIndices.length > 0) {
      console.log(LOG, "Step 6c — processing", againstIndices.length, "oppose items");

      for (const i of againstIndices) {
        try {
          // Compute termId from triple components
          const termId = await publicClient.readContract({
            address: MULTIVAULT_ADDRESS,
            abi: MultiVaultAbi,
            functionName: "calculateTripleId",
            args: [subjectIds[i]!, predicateIds[i]!, objectIds[i]!],
          });

          // Get counter_term_id (pure function, no indexer)
          const counterId = await publicClient.readContract({
            address: MULTIVAULT_ADDRESS,
            abi: MultiVaultAbi,
            functionName: "getCounterIdFromTripleId",
            args: [termId],
          });
          counterTermIds.set(i, counterId);
          console.log(LOG, `  Oppose ${i} → termId: ${termId} → counter: ${counterId}`);

          // The protocol forbids holding positions on both sides (HasCounterStake).
          // Check if the user has any "for" position and redeem it first.
          // This happens when: (a) createTriples just deposited the min into "for",
          // or (b) the user previously supported this claim and now opposes it.
          const shares = await multiVaultMaxRedeem(readConfig, {
            args: [fromAddress, termId, curveId],
          });
          if (shares > BigInt(0)) {
            console.log(LOG, `  Oppose ${i} — redeeming ${shares.toString()} shares from "for" vault`);
            await redeem(config, [fromAddress, termId, curveId, shares, BigInt(0)]);
          }
        } catch (err) {
          console.warn(LOG, `  Oppose ${i} — failed to resolve counter_term_id:`, err);
        }
      }

      // Build oppose deposit batch
      const opposeDepositTermIds: `0x${string}`[] = [];
      const opposeDepositCurveIds: bigint[] = [];
      const opposeDepositAssets: bigint[] = [];
      const opposeDepositMinShares: bigint[] = [];

      for (const [idx, counterTermId] of counterTermIds) {
        const item = items[idx]!;
        const opposeDeposit = item.depositAmount && item.depositAmount >= minTripleCost
          ? item.depositAmount
          : minTripleCost;
        opposeDepositTermIds.push(counterTermId as `0x${string}`);
        opposeDepositCurveIds.push(curveId);
        opposeDepositAssets.push(opposeDeposit);
        opposeDepositMinShares.push(BigInt(0));
      }

      if (opposeDepositTermIds.length > 0) {
        const opposeValue = opposeDepositAssets.reduce((sum, a) => sum + a, BigInt(0));
        const opposeTxHash = await multiVaultDepositBatch(config, {
          args: [fromAddress, opposeDepositTermIds, opposeDepositCurveIds, opposeDepositAssets, opposeDepositMinShares],
          value: opposeValue,
        });
        if (!triplesTxHash) triplesTxHash = opposeTxHash;
        console.log(LOG, "Step 6c — deposited into", opposeDepositTermIds.length, "counter vaults (against), tx:", opposeTxHash);
      }
    }

    // ── Step 7: Compute termId for every item deterministically ──
    // Don't rely on event parsing — calculateTripleId is a pure function
    // that gives us the exact termId from subject/predicate/object.
    console.log(LOG, "Step 7 — computing termIds for all", items.length, "items");
    const resultItems = await Promise.all(
      items.map(async (item, i) => {
        // "against" items → use counter_term_id
        if (item.stance === "against" && counterTermIds.has(i)) {
          const counterId = counterTermIds.get(i)!;
          console.log(LOG, `  item ${i} → against → counter: ${String(counterId).slice(0, 16)}`);
          return { attestationId: item.attestationId, onchainId: String(counterId) };
        }

        // Use pre-resolved termId from Step 6b (existing triples)
        if (existingTermIds.has(i)) {
          const termId = existingTermIds.get(i)!;
          console.log(LOG, `  item ${i} → existing → ${String(termId).slice(0, 16)}`);
          return { attestationId: item.attestationId, onchainId: String(termId) };
        }

        // Compute termId from triple components (pure contract call, no events)
        const termId = await publicClient.readContract({
          address: MULTIVAULT_ADDRESS,
          abi: MultiVaultAbi,
          functionName: "calculateTripleId",
          args: [subjectIds[i]!, predicateIds[i]!, objectIds[i]!],
        });
        console.log(LOG, `  item ${i} → computed → ${String(termId).slice(0, 16)}`);
        return { attestationId: item.attestationId, onchainId: String(termId) };
      }),
    );

    if (!triplesTxHash) {
      throw new IntuitionError(
        "TRANSACTION_FAILED",
        "No transaction was produced. Please try again.",
      );
    }

    const finalTxHash = triplesTxHash;
    console.log(LOG, "DONE ✓ —", {
      atomsTxHash,
      triplesTxHash: finalTxHash,
      created: items.length - existingIndices.size,
      existingDeposited: existingIndices.size,
      opposeDeposited: counterTermIds.size,
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
   LAYER: withdrawal
════════════════════════════════════════════════ */

/**
 * Withdraw staking positions for minted attestations.
 *
 * Calls `redeem()` on the MultiVault contract for each attestation's
 * triple vault, withdrawing the user's full share balance.
 *
 * Must be called BEFORE soft-deleting the attestation from the DB.
 * The caller should persist the result via POST /api/attestation/batch-withdraw.
 */
export async function withdrawAttestations(
  fromAddress: Address,
  items: BatchWithdrawItem[],
): Promise<BatchWithdrawResult> {
  if (!INTUITION_ENABLED) {
    throw new IntuitionError("NETWORK_ERROR", "Intuition integration is not enabled");
  }

  if (items.length === 0) {
    throw new IntuitionError("TRANSACTION_FAILED", "No attestations to withdraw");
  }

  console.log(LOG, "WITHDRAW START —", { from: fromAddress, count: items.length });

  try {
    const walletClient = await requireWalletClient();
    const writeConfig = buildWriteConfig(walletClient);
    const wCurveId = await getDefaultCurveId();

    // ── Step 1: Query max redeemable shares for each item ──
    console.log(LOG, "WITHDRAW — querying shares for", items.length, "items, curveId:", wCurveId.toString());
    const shareQueries = await Promise.all(
      items.map(async (item) => {
        console.log(LOG, `WITHDRAW — maxRedeem(${fromAddress}, ${item.onchainId}, ${wCurveId})`);
        const shares = await multiVaultMaxRedeem(readConfig, {
          args: [fromAddress, item.onchainId as `0x${string}`, wCurveId],
        });
        console.log(LOG, `WITHDRAW — ${item.onchainId} → shares: ${shares.toString()}`);
        return { ...item, shares };
      }),
    );

    // Filter items with redeemable shares
    const redeemable = shareQueries.filter((item) => item.shares > BigInt(0));

    if (redeemable.length === 0) {
      console.log(LOG, "WITHDRAW — no redeemable shares found");
      throw new IntuitionError(
        "TRANSACTION_FAILED",
        "No onchain position found to withdraw. The attestation may have already been withdrawn or the onchain ID is invalid.",
      );
    }

    console.log(LOG, "WITHDRAW — shares to redeem:", redeemable.map((r) => ({
      onchainId: r.onchainId,
      shares: r.shares.toString(),
    })));

    // ── Step 2: Redeem each position ──
    // Redeem one at a time — each gets a separate tx for clarity.
    // The SDK's redeem() handles the wallet signature prompt.
    let lastTxHash = "";

    for (const item of redeemable) {
      console.log(LOG, `WITHDRAW — redeeming ${item.onchainId} (${item.shares} shares)`);

      const result = await redeem(writeConfig, [
        fromAddress,                        // receiver
        item.onchainId as `0x${string}`,    // termId
        wCurveId,                           // curveId (from contract config)
        item.shares,                        // shares (full balance)
        BigInt(0),                          // minAssets (no slippage protection)
      ]);

      lastTxHash = result.transactionHash;
      console.log(LOG, `WITHDRAW — redeemed ${item.onchainId}, tx: ${lastTxHash}`);
    }

    console.log(LOG, "WITHDRAW DONE ✓ —", {
      txHash: lastTxHash,
      redeemed: redeemable.length,
      skipped: items.length - redeemable.length,
    });

    return {
      txHash: lastTxHash,
      items: items.map((item) => ({
        attestationId: item.attestationId,
        onchainId: item.onchainId,
      })),
    };
  } catch (error) {
    console.error(LOG, "WITHDRAW ERROR ✗ —", error);
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

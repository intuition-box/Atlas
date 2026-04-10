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
  batchCreateAtomsFromIpfsUris,
  pinThing,
  multiVaultCreateTriples,
  multiVaultGetTripleCost,
  multiVaultGetGeneralConfig,
  multiVaultIsTermCreated,
  calculateAtomId,
  calculateTripleId,
  calculateCounterTripleId,
  batchRedeem,
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
  I_ATOM_TERM_ID,
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

/** Cache predicate termIds to avoid redundant lookups. */
const predicateCache = new Map<AttestationType, `0x${string}`>();

/**
 * Resolve a predicate atom's IPFS URI and termId (no on-chain write).
 *
 * Returns { termId, uri } if the predicate can be resolved via hardcoded ID
 * or IPFS pin. The caller is responsible for checking on-chain existence and
 * batch-creating any missing atoms.
 */
async function resolvePredicateUri(
  type: AttestationType,
): Promise<{ termId: `0x${string}`; uri: string | null; needsCreation: boolean }> {
  // Check cache first
  const cached = predicateCache.get(type);
  if (cached) return { termId: cached, uri: null, needsCreation: false };

  // Check for hardcoded ecosystem atom term_id (0 transactions)
  const hardcoded = getHardcodedTermId(type);
  if (hardcoded) {
    predicateCache.set(type, hardcoded);
    return { termId: hardcoded, uri: null, needsCreation: false };
  }

  // Pin to IPFS (no on-chain write yet)
  const thingData = getPredicateThingData(type);
  const uri = await pinThing(thingData);

  if (uri) {
    const atomData = toHex(uri);
    const termId = calculateAtomId(atomData);

    // Check on-chain existence
    const exists = await multiVaultIsTermCreated(readConfig, { args: [termId] });
    if (exists) {
      predicateCache.set(type, termId);
      return { termId, uri, needsCreation: false };
    }

    return { termId, uri, needsCreation: true };
  }

  // Fallback: legacy string atom if pinning fails
  const fallbackUri = getPredicateForType(type);
  const atomData = toHex(fallbackUri);
  const termId = calculateAtomId(atomData);

  const exists = await multiVaultIsTermCreated(readConfig, { args: [termId] });
  if (exists) {
    predicateCache.set(type, termId);
    return { termId, uri: fallbackUri, needsCreation: false };
  }

  return { termId, uri: fallbackUri, needsCreation: true };
}

/* ════════════════════════════════════════════════
   LAYER: thing atoms (rich atoms)
════════════════════════════════════════════════ */

/** Cache attribute termIds to avoid redundant IPFS pins + on-chain lookups. */
const attributeAtomCache = new Map<string, `0x${string}`>();

/**
 * Resolve a rich Thing atom's IPFS URI and termId (no on-chain write).
 *
 * Flow: pin JSON-LD to IPFS → check on-chain existence.
 * The caller is responsible for batch-creating any missing atoms.
 */
async function resolveThingAtomUri(
  attributeId: string,
): Promise<{ termId: `0x${string}`; uri: string; needsCreation: boolean }> {
  const cached = attributeAtomCache.get(attributeId);
  if (cached) return { termId: cached, uri: "", needsCreation: false };

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
    attributeAtomCache.set(attributeId, termId);
    return { termId, uri, needsCreation: false };
  }

  return { termId, uri, needsCreation: true };
}

/* ════════════════════════════════════════════════
   LAYER: attestations
════════════════════════════════════════════════ */

/**
 * Batch-create attestation triples on Intuition.
 *
 * Minimizes wallet signatures by batching all operations:
 * 1. Query indexer for existing atoms (0 signatures)
 * 2. Pin all predicates + attributes to IPFS (0 signatures)
 * 3. Batch-create ALL missing atoms — addresses + predicates + attributes (0–1 signature)
 * 4. Pre-check which triples exist, batch-create only new ones (0–1 signature)
 * 5. Batch-deposit into existing triples (0–1 signature)
 * 6. Batch-redeem + batch-deposit for "against" items (0–2 signatures)
 *
 * Best case: 1 wallet signature. Typical: 1–2. Worst case: 4.
 */
export async function batchCreateAttestations(
  fromAddress: Address,
  items: BatchMintItem[],
): Promise<BatchMintResult> {

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
    const uniqueAttributeIds = Array.from(
      new Set(items.filter((i) => i.attributeId).map((i) => i.attributeId!)),
    );

    // ── Step 2: Resolve address atoms via on-chain check (0 signatures) ──
    // Don't trust the indexer — verify on-chain existence directly.
    const known = new Map<string, `0x${string}`>();

    // Compute termIds deterministically and check on-chain existence in parallel
    const addressChecks = await Promise.all(
      uniqueAddresses.map(async (addr) => {
        const termId = calculateAtomId(toHex(addr));
        const exists = await multiVaultIsTermCreated(readConfig, { args: [termId] });
        return { addr, termId, exists };
      }),
    );

    for (const { addr, termId, exists } of addressChecks) {
      if (exists) {
        known.set(addr.toLowerCase(), termId);
      }
    }

    // ── Step 3: Resolve all predicate + attribute URIs via IPFS (0 signatures) ──
    // Pin everything to IPFS and check on-chain existence, but don't create yet.
    const predicateTermIds = new Map<AttestationType, `0x${string}`>();
    const attributeTermIds = new Map<string, `0x${string}`>();
    const atomUrisToCreate: string[] = [];

    for (const type of uniqueTypes) {
      const resolved = await resolvePredicateUri(type);
      predicateTermIds.set(type, resolved.termId);
      if (resolved.needsCreation && resolved.uri) {
        atomUrisToCreate.push(resolved.uri);
      }
    }

    for (const attrId of uniqueAttributeIds) {
      const resolved = await resolveThingAtomUri(attrId);
      attributeTermIds.set(attrId, resolved.termId);
      if (resolved.needsCreation) {
        atomUrisToCreate.push(resolved.uri);
      }
    }

    // ── Step 4: Batch-create ALL missing atoms (0–1 signature per type) ──
    const missingAddresses = uniqueAddresses.filter(
      (addr) => !known.has(addr.toLowerCase()),
    );

    let atomsTxHash: string | null = null;

    // Create missing address atoms (raw address data, no IPFS)
    if (missingAddresses.length > 0) {
      try {
        const atomsResult = await batchCreateAtomsFromEthereumAccounts(config, missingAddresses);
        atomsTxHash = atomsResult.transactionHash;

        missingAddresses.forEach((addr, i) => {
          known.set(addr.toLowerCase(), atomsResult.state[i].termId);
        });
      } catch (error) {
        if (isAtomExistsError(error)) {
          for (const addr of missingAddresses) {
            try {
              const result = await createAtomFromEthereumAccount(config, addr);
              known.set(addr.toLowerCase(), result.state.termId);
            } catch (innerError) {
              if (isAtomExistsError(innerError)) {
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

    // Batch-create all missing URI atoms (predicates + attributes) in ONE tx
    if (atomUrisToCreate.length > 0) {
      try {
        const result = await batchCreateAtomsFromIpfsUris(config, atomUrisToCreate);
        if (!atomsTxHash) atomsTxHash = result.transactionHash;
      } catch (error) {
        if (isAtomExistsError(error)) {
          // Some atoms already exist — fall back to one-by-one but skip existing
          for (const uri of atomUrisToCreate) {
            const termId = calculateAtomId(toHex(uri));
            const exists = await multiVaultIsTermCreated(readConfig, { args: [termId] });
            if (!exists) {
              const result = await createAtomFromString(config, uri);
              if (!atomsTxHash) atomsTxHash = result.transactionHash;
            }
          }
        } else {
          throw error;
        }
      }

      // Update caches for successfully created atoms
      for (const type of uniqueTypes) {
        const termId = predicateTermIds.get(type)!;
        predicateCache.set(type, termId);
      }
      for (const attrId of uniqueAttributeIds) {
        const termId = attributeTermIds.get(attrId)!;
        attributeAtomCache.set(attrId, termId);
      }
    }

    // ── Step 5: Build triple arrays + pre-check existence ──
    const fromTermId = known.get(fromAddress.toLowerCase())!;
    const minTripleCost = await getTripleCost();
    const curveId = await getDefaultCurveId();

    const subjectIds: `0x${string}`[] = [];
    const predicateIdsArr: `0x${string}`[] = [];
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
          subjectIds.push(fromTermId);
          predicateIdsArr.push(predicateTermIds.get(item.type)!);
          objectIds.push(toTermId);
        } else {
          subjectIds.push(toTermId);
          predicateIdsArr.push(predicateTermIds.get(item.type)!);
          objectIds.push(attrTermId);
        }
      } else {
        const subject = item.type === "FOLLOW" ? I_ATOM_TERM_ID : fromTermId;
        subjectIds.push(subject);
        predicateIdsArr.push(predicateTermIds.get(item.type)!);
        objectIds.push(known.get(item.toAddress.toLowerCase())!);
      }

      if (item.stance === "against") {
        deposits.push(minTripleCost);
        againstIndices.push(idx);
      } else {
        const deposit = item.depositAmount && item.depositAmount >= minTripleCost
          ? item.depositAmount
          : minTripleCost;
        deposits.push(deposit);
      }
    }

    // Pre-check which triples already exist (0 signatures — read-only)
    const existingIndices = new Set<number>();
    const existingTermIds = new Map<number, string>();

    const existenceChecks = await Promise.all(
      items.map((_, i) => {
        const termId = calculateTripleId(subjectIds[i]!, predicateIdsArr[i]!, objectIds[i]!);
        return multiVaultIsTermCreated(readConfig, { args: [termId] })
          .then((exists) => ({ index: i, termId, exists }))
          .catch(() => ({ index: i, termId, exists: false }));
      }),
    );

    for (const check of existenceChecks) {
      if (check.exists) {
        existingIndices.add(check.index);
        existingTermIds.set(check.index, check.termId);
      }
    }

    // Balance check
    const newIndices = items.map((_, i) => i).filter((i) => !existingIndices.has(i));
    const createTriplesTotal = newIndices.reduce((sum, i) => sum + deposits[i]!, BigInt(0));
    const existingDepositTotal = [...existingIndices]
      .filter((i) => items[i]?.stance !== "against")
      .reduce((sum, i) => sum + deposits[i]!, BigInt(0));
    let againstDepositTotal = BigInt(0);
    for (const i of againstIndices) {
      const item = items[i]!;
      const deposit = item.depositAmount && item.depositAmount >= minTripleCost
        ? item.depositAmount
        : minTripleCost;
      againstDepositTotal += deposit;
    }
    const totalValue = createTriplesTotal + existingDepositTotal + againstDepositTotal;

    const balance = await publicClient.getBalance({ address: fromAddress });

    if (balance < totalValue) {
      throw new IntuitionError(
        "INSUFFICIENT_FUNDS",
        `Need ${formatEther(totalValue)} ${NATIVE_CURRENCY_SYMBOL} to publish ${items.length} attestation${items.length !== 1 ? "s" : ""} but wallet only has ${formatEther(balance)} ${NATIVE_CURRENCY_SYMBOL}.`,
      );
    }

    // ── Step 6: Batch-create only NEW triples (0–1 signature) ──
    let triplesTxHash: `0x${string}` | null = null;

    if (newIndices.length > 0) {
      const newSubjects = newIndices.map((i) => subjectIds[i]!);
      const newPredicates = newIndices.map((i) => predicateIdsArr[i]!);
      const newObjects = newIndices.map((i) => objectIds[i]!);
      const newDeposits = newIndices.map((i) => deposits[i]!);
      const newTotal = newDeposits.reduce((sum, d) => sum + d, BigInt(0));

      triplesTxHash = await multiVaultCreateTriples(config, {
        args: [newSubjects, newPredicates, newObjects, newDeposits],
        value: newTotal,
      });
    }

    // ── Step 6b: Batch-deposit into existing "for" triples (0–1 signature) ──
    if (existingIndices.size > 0) {
      const forDepositTermIds: `0x${string}`[] = [];
      const forDepositCurveIds: bigint[] = [];
      const forDepositAssets: bigint[] = [];
      const forDepositMinShares: bigint[] = [];

      // Check for counter positions that need redeeming first (batch)
      const counterRedeemTermIds: `0x${string}`[] = [];
      const counterRedeemCurveIds: bigint[] = [];
      const counterRedeemShares: bigint[] = [];
      const counterRedeemMinAssets: bigint[] = [];

      for (const i of existingIndices) {
        if (items[i]?.stance === "against") continue;

        const termId = existingTermIds.get(i)! as `0x${string}`;
        const counterTermId = calculateCounterTripleId(termId);
        const counterShares = await multiVaultMaxRedeem(readConfig, {
          args: [fromAddress, counterTermId as `0x${string}`, curveId],
        });

        if (counterShares > BigInt(0)) {
          counterRedeemTermIds.push(counterTermId as `0x${string}`);
          counterRedeemCurveIds.push(curveId);
          counterRedeemShares.push(counterShares);
          counterRedeemMinAssets.push(BigInt(0));
        }

        forDepositTermIds.push(termId);
        forDepositCurveIds.push(curveId);
        forDepositAssets.push(deposits[i]!);
        forDepositMinShares.push(BigInt(0));
      }

      // Batch-redeem counter positions if any (1 signature instead of N)
      if (counterRedeemTermIds.length > 0) {
        await batchRedeem(config, [
          fromAddress, counterRedeemTermIds, counterRedeemCurveIds,
          counterRedeemShares, counterRedeemMinAssets,
        ]);
      }

      if (forDepositTermIds.length > 0) {
        const depositValue = forDepositAssets.reduce((sum, a) => sum + a, BigInt(0));
        const depositTxHash = await multiVaultDepositBatch(config, {
          args: [fromAddress, forDepositTermIds, forDepositCurveIds, forDepositAssets, forDepositMinShares],
          value: depositValue,
        });
        if (!triplesTxHash) triplesTxHash = depositTxHash;
      }
    }

    // ── Step 6c: Oppose — batch-redeem "for" + batch-deposit counter vault ──
    const counterTermIds = new Map<number, string>();

    if (againstIndices.length > 0) {
      // Collect all "for" positions that need redeeming
      const redeemTermIds: `0x${string}`[] = [];
      const redeemCurveIds: bigint[] = [];
      const redeemShares: bigint[] = [];
      const redeemMinAssets: bigint[] = [];

      for (const i of againstIndices) {
        const termId = calculateTripleId(subjectIds[i]!, predicateIdsArr[i]!, objectIds[i]!);
        const counterId = calculateCounterTripleId(termId);
        counterTermIds.set(i, counterId);

        const shares = await multiVaultMaxRedeem(readConfig, {
          args: [fromAddress, termId, curveId],
        });
        if (shares > BigInt(0)) {
          redeemTermIds.push(termId);
          redeemCurveIds.push(curveId);
          redeemShares.push(shares);
          redeemMinAssets.push(BigInt(0));
        }
      }

      // Batch-redeem all "for" positions (1 signature instead of N)
      if (redeemTermIds.length > 0) {
        await batchRedeem(config, [
          fromAddress, redeemTermIds, redeemCurveIds,
          redeemShares, redeemMinAssets,
        ]);
      }

      // Batch-deposit into counter vaults (1 signature)
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
      }
    }

    // ── Step 7: Compute termId for every item deterministically ──
    const resultItems = items.map((item, i) => {
      if (item.stance === "against" && counterTermIds.has(i)) {
        return { attestationId: item.attestationId, onchainId: String(counterTermIds.get(i)!) };
      }
      if (existingTermIds.has(i)) {
        return { attestationId: item.attestationId, onchainId: String(existingTermIds.get(i)!) };
      }
      const termId = calculateTripleId(subjectIds[i]!, predicateIdsArr[i]!, objectIds[i]!);
      return { attestationId: item.attestationId, onchainId: String(termId) };
    });

    if (!triplesTxHash) {
      throw new IntuitionError(
        "TRANSACTION_FAILED",
        "No transaction was produced. Please try again.",
      );
    }

    const finalTxHash = triplesTxHash;

    return {
      atomsTxHash: atomsTxHash ?? finalTxHash,
      triplesTxHash: finalTxHash,
      items: resultItems,
    };
  } catch (error) {
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


  try {
    const walletClient = await requireWalletClient();
    const writeConfig = buildWriteConfig(walletClient);
    const wCurveId = await getDefaultCurveId();

    // ── Step 1: Query max redeemable shares for each item ──
    const shareQueries = await Promise.all(
      items.map(async (item) => {
        const shares = await multiVaultMaxRedeem(readConfig, {
          args: [fromAddress, item.onchainId as `0x${string}`, wCurveId],
        });
        return { ...item, shares };
      }),
    );

    // Filter items with redeemable shares
    const redeemable = shareQueries.filter((item) => item.shares > BigInt(0));

    if (redeemable.length === 0) {
      throw new IntuitionError(
        "TRANSACTION_FAILED",
        "No onchain position found to withdraw. The attestation may have already been withdrawn or the onchain ID is invalid.",
      );
    }


    // ── Step 2: Batch-redeem all positions (1 signature) ──
    const result = await batchRedeem(writeConfig, [
      fromAddress,
      redeemable.map((item) => item.onchainId as `0x${string}`),
      redeemable.map(() => wCurveId),
      redeemable.map((item) => item.shares),
      redeemable.map(() => BigInt(0)),
    ]);

    const lastTxHash = result.transactionHash;


    return {
      txHash: lastTxHash,
      items: items.map((item) => ({
        attestationId: item.attestationId,
        onchainId: item.onchainId,
      })),
    };
  } catch (error) {
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

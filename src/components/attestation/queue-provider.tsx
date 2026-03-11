"use client";

import * as React from "react";
import { useSession } from "next-auth/react";

import type { AttestationType } from "@/lib/attestations/definitions";
import { apiGet, apiPost } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";

/* ────────────────────────────
   Types
──────────────────────────── */

export type UnmintedAttestation = {
  id: string;
  type: AttestationType;
  attributeId: string | null;
  stance: "for" | "against";
  createdAt: string;
  toUser: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
    walletAddress: string | null;
  };
};

type CreateAttestationParams = {
  toUserId: string;
  toName: string;
  toHandle?: string;
  toAvatarUrl?: string | null;
  toWalletAddress?: string | null;
  type: AttestationType;
  /** Required for SKILL_ENDORSE — references AttributeId from definitions.ts */
  attributeId?: string;
  /** Where this attestation was initiated (e.g. "profile", "orbit") */
  source?: string;
  /** Stance: "for" (support) or "against" (oppose). Defaults to "for". */
  stance?: "for" | "against";
};

type AttestationCartContextValue = {
  /** Unminted attestations from DB (given by viewer) */
  unminted: UnmintedAttestation[];
  /** Whether the cart panel is open */
  isOpen: boolean;
  /** Whether fetching unminted attestations */
  isFetching: boolean;
  /** Timestamp of last change — use to trigger refetches downstream */
  lastChangedAt: number;
  /** Timestamp of last attestation creation — triggers dock visibility */
  lastCreatedAt: number;
  /** Ref to the cart button for flying animation target */
  buttonRef: React.RefObject<HTMLButtonElement | null>;

  /** Create attestation immediately in DB */
  createAttestation: (params: CreateAttestationParams) => Promise<{ ok: boolean; id?: string }>;
  /** Retract (soft-delete) a single attestation */
  retractAttestation: (id: string) => Promise<void>;
  /** Retract all unminted attestations */
  retractAll: () => Promise<void>;
  /** Update the stance of an unminted attestation */
  updateStance: (id: string, stance: "for" | "against") => Promise<void>;
  /** Remove a minted item from unminted list and notify downstream */
  onItemMinted: (id: string) => void;

  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
};

/* ────────────────────────────
   API response types
──────────────────────────── */

type ListResponse = {
  attestations: Array<{
    id: string;
    type: string;
    attributeId: string | null;
    stance: string | null;
    confidence: number | null;
    createdAt: string;
    mintedAt: string | null;
    fromUser: {
      id: string;
      handle: string | null;
      name: string | null;
      avatarUrl: string | null;
      headline: string | null;
    };
    toUser: {
      id: string;
      handle: string | null;
      name: string | null;
      avatarUrl: string | null;
      headline: string | null;
      walletAddress: string | null;
    };
  }>;
  nextCursor: string | null;
};

type CreateResponse = {
  attestation: { id: string };
  alreadyExists: boolean;
};

/* ────────────────────────────
   Context
──────────────────────────── */

const AttestationCartContext = React.createContext<AttestationCartContextValue | null>(null);

/* ────────────────────────────
   Provider
──────────────────────────── */

export function AttestationQueueProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const viewerId = session?.user?.id ?? null;

  const [unminted, setUnminted] = React.useState<UnmintedAttestation[]>([]);
  const [isFetching, setIsFetching] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [lastChangedAt, setLastChangedAt] = React.useState(0);
  const [lastCreatedAt, setLastCreatedAt] = React.useState(0);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  // Track previous isOpen to detect open transitions
  const prevIsOpenRef = React.useRef(false);

  /* ── Fetch unminted attestations from DB ── */

  const fetchUnminted = React.useCallback(async (userId: string, signal?: AbortSignal) => {
    setIsFetching(true);
    try {
      const result = await apiGet<ListResponse>("/api/attestation/list", {
        fromUserId: userId,
        minted: "false",
        take: 100,
      }, { signal });

      if (result.ok) {
        setUnminted(
          result.value.attestations.map((a) => ({
            id: a.id,
            type: a.type as AttestationType,
            attributeId: a.attributeId ?? null,
            stance: (a.stance === "against" ? "against" : "for") as "for" | "against",
            createdAt: a.createdAt,
            toUser: {
              id: a.toUser.id,
              handle: a.toUser.handle,
              name: a.toUser.name,
              avatarUrl: a.toUser.avatarUrl,
              walletAddress: a.toUser.walletAddress,
            },
          })),
        );
      }
    } finally {
      setIsFetching(false);
    }
  }, []);

  /* ── Initial fetch on auth ── */

  React.useEffect(() => {
    if (!viewerId) {
      setUnminted([]);
      return;
    }

    const controller = new AbortController();
    fetchUnminted(viewerId, controller.signal);
    return () => controller.abort();
  }, [viewerId, fetchUnminted]);

  /* ── Refetch when panel opens ── */

  React.useEffect(() => {
    if (isOpen && !prevIsOpenRef.current && viewerId) {
      fetchUnminted(viewerId);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, viewerId, fetchUnminted]);

  /* ── Refetch on tab visibility ── */

  React.useEffect(() => {
    if (!viewerId) return;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchUnminted(viewerId);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [viewerId, fetchUnminted]);

  /* ── One-time localStorage cleanup ── */

  React.useEffect(() => {
    try {
      localStorage.removeItem("attestation-queue");
    } catch {
      // Ignore
    }
  }, []);

  /* ── Actions ── */

  const createAttestation = React.useCallback(
    async (params: CreateAttestationParams): Promise<{ ok: boolean; id?: string }> => {
      const result = await apiPost<CreateResponse>("/api/attestation/create", {
        toUserId: params.toUserId,
        type: params.type,
        ...(params.attributeId ? { attributeId: params.attributeId } : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(params.stance ? { stance: params.stance } : {}),
      });

      if (!result.ok) {
        return { ok: false };
      }

      const { id } = result.value.attestation;

      // Optimistically add to unminted list (skip if already exists — idempotent create)
      if (!result.value.alreadyExists) {
        setUnminted((prev) => [
          {
            id,
            type: params.type,
            attributeId: params.attributeId ?? null,
            stance: params.stance ?? "for",
            createdAt: new Date().toISOString(),
            toUser: {
              id: params.toUserId,
              handle: params.toHandle ?? null,
              name: params.toName,
              avatarUrl: params.toAvatarUrl ?? null,
              walletAddress: params.toWalletAddress ?? null,
            },
          },
          ...prev,
        ]);
      }

      const now = Date.now();
      setLastChangedAt(now);
      setLastCreatedAt(now);
      return { ok: true, id };
    },
    [],
  );

  const retractAttestation = React.useCallback(
    async (id: string) => {
      // Optimistic removal
      const snapshot = unminted;
      setUnminted((prev) => prev.filter((a) => a.id !== id));

      const result = await apiPost("/api/attestation/retract", {
        attestationId: id,
      });

      if (!result.ok) {
        // Rollback
        setUnminted(snapshot);
        sounds.error();
        return;
      }

      setLastChangedAt(Date.now());
    },
    [unminted],
  );

  const retractAll = React.useCallback(async () => {
    if (unminted.length === 0) return;

    const snapshot = [...unminted];
    setUnminted([]);

    const results = await Promise.allSettled(
      snapshot.map((a) =>
        apiPost("/api/attestation/retract", { attestationId: a.id }),
      ),
    );

    // Re-add any that failed
    const failures: UnmintedAttestation[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)) {
        failures.push(snapshot[i]!);
      }
    });

    if (failures.length > 0) {
      setUnminted(failures);
      sounds.error();
    }

    setLastChangedAt(Date.now());
  }, [unminted]);

  const updateStance = React.useCallback(
    async (id: string, stance: "for" | "against") => {
      // Optimistic update
      const snapshot = unminted;
      setUnminted((prev) =>
        prev.map((a) => (a.id === id ? { ...a, stance } : a)),
      );

      const result = await apiPost<{ attestation: { id: string; stance: string } }>(
        "/api/attestation/update-stance",
        { attestationId: id, stance },
      );

      if (!result.ok) {
        // Rollback
        setUnminted(snapshot);
        sounds.error();
        return;
      }

      setLastChangedAt(Date.now());
    },
    [unminted],
  );

  const onItemMinted = React.useCallback((id: string) => {
    setUnminted((prev) => prev.filter((a) => a.id !== id));
    setLastChangedAt(Date.now());
  }, []);

  const toggleOpen = React.useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  /* ── Context value ── */

  const value = React.useMemo(
    () => ({
      unminted,
      isOpen,
      isFetching,
      lastChangedAt,
      lastCreatedAt,
      buttonRef,
      createAttestation,
      retractAttestation,
      retractAll,
      updateStance,
      onItemMinted,
      setIsOpen,
      toggleOpen,
    }),
    [unminted, isOpen, isFetching, lastChangedAt, lastCreatedAt, createAttestation, retractAttestation, retractAll, updateStance, onItemMinted, toggleOpen],
  );

  return (
    <AttestationCartContext.Provider value={value}>
      {children}
    </AttestationCartContext.Provider>
  );
}

/* ────────────────────────────
   Hooks
──────────────────────────── */

export function useAttestationQueue() {
  const context = React.useContext(AttestationCartContext);
  if (!context) {
    throw new Error("useAttestationQueue must be used within AttestationQueueProvider");
  }
  return context;
}

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
  createdAt: string;
  toUser: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
};

type CreateAttestationParams = {
  toUserId: string;
  toName: string;
  toHandle?: string;
  toAvatarUrl?: string | null;
  type: AttestationType;
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
  /** Ref to the cart button for flying animation target */
  buttonRef: React.RefObject<HTMLButtonElement | null>;

  /** Create attestation immediately in DB */
  createAttestation: (params: CreateAttestationParams) => Promise<{ ok: boolean; id?: string }>;
  /** Retract (soft-delete) a single attestation */
  retractAttestation: (id: string) => Promise<void>;
  /** Retract all unminted attestations */
  retractAll: () => Promise<void>;
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
            createdAt: a.createdAt,
            toUser: {
              id: a.toUser.id,
              handle: a.toUser.handle,
              name: a.toUser.name,
              avatarUrl: a.toUser.avatarUrl,
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
            createdAt: new Date().toISOString(),
            toUser: {
              id: params.toUserId,
              handle: params.toHandle ?? null,
              name: params.toName,
              avatarUrl: params.toAvatarUrl ?? null,
            },
          },
          ...prev,
        ]);
      }

      setLastChangedAt(Date.now());
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
      buttonRef,
      createAttestation,
      retractAttestation,
      retractAll,
      onItemMinted,
      setIsOpen,
      toggleOpen,
    }),
    [unminted, isOpen, isFetching, lastChangedAt, createAttestation, retractAttestation, retractAll, onItemMinted, toggleOpen],
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

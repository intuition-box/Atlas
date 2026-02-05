"use client";

import * as React from "react";
import type { AttestationType } from "@/config/attestations";

/* ────────────────────────────
   Constants
──────────────────────────── */

const STORAGE_KEY = "attestation-queue";

/* ────────────────────────────
   Types
──────────────────────────── */

export type QueuedAttestation = {
  id: string; // Client-side unique ID for the queue item
  toUserId: string;
  toName: string;
  toHandle?: string;
  toAvatarUrl?: string | null;
  type: AttestationType;
};

type AttestationQueueContextValue = {
  queue: QueuedAttestation[];
  addToQueue: (attestation: Omit<QueuedAttestation, "id">) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  isInQueue: (toUserId: string, type: AttestationType) => boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  /** Ref to the queue button for flying animation target */
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  /** Timestamp of last successful save - use to trigger refetches */
  lastSavedAt: number;
  /** Call after successfully saving attestations to trigger button refetches */
  markSaved: () => void;
};

/* ────────────────────────────
   Helpers
──────────────────────────── */

function loadQueueFromStorage(): QueuedAttestation[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveQueueToStorage(queue: QueuedAttestation[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Storage full or disabled - fail silently
  }
}

/* ────────────────────────────
   Context
──────────────────────────── */

const AttestationQueueContext = React.createContext<AttestationQueueContextValue | null>(null);

/* ────────────────────────────
   Provider
──────────────────────────── */

export function AttestationQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = React.useState<QueuedAttestation[]>([]);
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState(0);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  // Load from localStorage on mount
  React.useEffect(() => {
    const stored = loadQueueFromStorage();
    setQueue(stored);
    setIsHydrated(true);
  }, []);

  // Persist to localStorage when queue changes (after hydration)
  React.useEffect(() => {
    if (isHydrated) {
      saveQueueToStorage(queue);
    }
  }, [queue, isHydrated]);

  const addToQueue = React.useCallback((attestation: Omit<QueuedAttestation, "id">) => {
    setQueue((prev) => {
      // Check if already in queue (same user + type)
      const exists = prev.some(
        (item) =>
          item.toUserId === attestation.toUserId &&
          item.type === attestation.type
      );
      if (exists) return prev;

      const newItem: QueuedAttestation = {
        ...attestation,
        id: `${attestation.toUserId}-${attestation.type}-${Date.now()}`,
      };
      return [...prev, newItem];
    });
  }, []);

  const removeFromQueue = React.useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearQueue = React.useCallback(() => {
    setQueue([]);
  }, []);

  const isInQueue = React.useCallback(
    (toUserId: string, type: AttestationType) => {
      return queue.some(
        (item) =>
          item.toUserId === toUserId &&
          item.type === type
      );
    },
    [queue]
  );

  const toggleOpen = React.useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const markSaved = React.useCallback(() => {
    setLastSavedAt(Date.now());
  }, []);

  const value = React.useMemo(
    () => ({
      queue,
      addToQueue,
      removeFromQueue,
      clearQueue,
      isInQueue,
      isOpen,
      setIsOpen,
      toggleOpen,
      buttonRef,
      lastSavedAt,
      markSaved,
    }),
    [queue, addToQueue, removeFromQueue, clearQueue, isInQueue, isOpen, toggleOpen, lastSavedAt, markSaved]
  );

  return (
    <AttestationQueueContext.Provider value={value}>
      {children}
    </AttestationQueueContext.Provider>
  );
}

/* ────────────────────────────
   Hooks
──────────────────────────── */

export function useAttestationQueue() {
  const context = React.useContext(AttestationQueueContext);
  if (!context) {
    throw new Error("useAttestationQueue must be used within AttestationQueueProvider");
  }
  return context;
}

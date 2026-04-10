"use client";

import * as React from "react";
import { useSession } from "next-auth/react";

import { apiGet, apiPost } from "@/lib/api/client";

/* ────────────────────────────
   Types
──────────────────────────── */

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationContextValue = {
  notifications: NotificationItem[];
  unreadCount: number;
  isOpen: boolean;
  isFetching: boolean;

  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  acceptInvite: (invitationId: string) => Promise<boolean>;
  declineInvite: (invitationId: string) => Promise<boolean>;
  refetch: () => void;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
};

const NotificationContext = React.createContext<NotificationContextValue | null>(null);

/* ────────────────────────────
   API response types
──────────────────────────── */

type ListResponse = {
  notifications: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
};

/* ────────────────────────────
   Provider
──────────────────────────── */

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const viewerId = session?.user?.id ?? null;

  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [isOpen, setIsOpen] = React.useState(false);
  const [isFetching, setIsFetching] = React.useState(false);
  const [lastFetchedAt, setLastFetchedAt] = React.useState(0);

  const toggleOpen = React.useCallback(() => setIsOpen((v) => !v), []);

  // Fetch notifications
  React.useEffect(() => {
    if (!viewerId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const controller = new AbortController();
    setIsFetching(true);

    void (async () => {
      const result = await apiGet<ListResponse>(
        "/api/notification/list",
        { take: 20 },
        { signal: controller.signal },
      );

      if (controller.signal.aborted) return;

      if (result.ok) {
        setNotifications(result.value.notifications);
        setUnreadCount(result.value.unreadCount);
      }
      setIsFetching(false);
    })();

    return () => controller.abort();
  }, [viewerId, lastFetchedAt]);

  // Refetch on tab visibility change
  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setLastFetchedAt(Date.now());
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Poll every 30 seconds for new notifications
  React.useEffect(() => {
    if (!viewerId) return;
    const interval = setInterval(() => setLastFetchedAt(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [viewerId]);

  const refetch = React.useCallback(() => setLastFetchedAt(Date.now()), []);

  const markRead = React.useCallback(async (id: string) => {
    // Optimistic
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    await apiPost("/api/notification/read", { notificationId: id });
  }, []);

  const markAllRead = React.useCallback(async () => {
    // Optimistic
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: now })),
    );
    setUnreadCount(0);

    await apiPost("/api/notification/read", { all: true });
  }, []);

  const acceptInvite = React.useCallback(async (invitationId: string) => {
    const result = await apiPost<{ accepted: true }>("/api/invitation/accept", { invitationId });
    if (result.ok) {
      refetch();
      return true;
    }
    return false;
  }, [refetch]);

  const declineInvite = React.useCallback(async (invitationId: string) => {
    const result = await apiPost<{ declined: true }>("/api/invitation/decline", { invitationId });
    if (result.ok) {
      refetch();
      return true;
    }
    return false;
  }, [refetch]);

  const value = React.useMemo<NotificationContextValue>(
    () => ({
      notifications,
      unreadCount,
      isOpen,
      isFetching,
      markRead,
      markAllRead,
      acceptInvite,
      declineInvite,
      refetch,
      setIsOpen,
      toggleOpen,
    }),
    [notifications, unreadCount, isOpen, isFetching, markRead, markAllRead, acceptInvite, declineInvite, refetch, toggleOpen],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

/* ────────────────────────────
   Hook
──────────────────────────── */

export function useNotifications(): NotificationContextValue {
  const context = React.useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}

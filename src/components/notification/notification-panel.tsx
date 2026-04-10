"use client";

import * as React from "react";
import { Bell, Check, CheckCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useNotifications, type NotificationItem } from "./notification-provider";

/* ────────────────────────────
   Panel
──────────────────────────── */

export function NotificationPanel() {
  const {
    notifications,
    unreadCount,
    isOpen,
    isFetching,
    setIsOpen,
    markRead,
    markAllRead,
    acceptInvite,
    declineInvite,
  } = useNotifications();

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Notifications</DialogTitle>
              <DialogDescription>
                {unreadCount > 0
                  ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
                  : "You're all caught up"}
              </DialogDescription>
            </div>
            {unreadCount > 0 && (
              <Button variant="ghost" size="xs" onClick={markAllRead} className="gap-1 text-xs">
                <CheckCheck className="size-3" />
                Mark all read
              </Button>
            )}
          </div>
        </DialogHeader>

        <div
          className={cn(
            "-mr-2 pr-2 max-h-[28rem] overflow-y-auto [scrollbar-width:thin]",
            notifications.length > 4 && "[mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]",
          )}
        >
          {isFetching && notifications.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Bell className="size-5 animate-pulse" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="size-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                You&apos;ll see invitations and activity here
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onMarkRead={markRead}
                  onAcceptInvite={acceptInvite}
                  onDeclineInvite={declineInvite}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────
   Row
──────────────────────────── */

function NotificationRow({
  notification,
  onMarkRead,
  onAcceptInvite,
  onDeclineInvite,
}: {
  notification: NotificationItem;
  onMarkRead: (id: string) => Promise<void>;
  onAcceptInvite: (invitationId: string) => Promise<boolean>;
  onDeclineInvite: (invitationId: string) => Promise<boolean>;
}) {
  const isRead = !!notification.readAt;
  const meta = notification.metadata as Record<string, unknown> | null;
  const isInvite = notification.type === "COMMUNITY_INVITE";
  const invitationId = meta?.invitationId as string | undefined;
  const [isActing, setIsActing] = React.useState(false);
  const [actionTaken, setActionTaken] = React.useState<"accepted" | "declined" | null>(null);

  const handleAccept = async () => {
    if (!invitationId || isActing) return;
    setIsActing(true);
    const ok = await onAcceptInvite(invitationId);
    if (ok) {
      setActionTaken("accepted");
      await onMarkRead(notification.id);
    }
    setIsActing(false);
  };

  const handleDecline = async () => {
    if (!invitationId || isActing) return;
    setIsActing(true);
    const ok = await onDeclineInvite(invitationId);
    if (ok) {
      setActionTaken("declined");
      await onMarkRead(notification.id);
    }
    setIsActing(false);
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg p-3 transition-colors",
        !isRead && "bg-primary/5",
        isRead && "opacity-60",
      )}
      onClick={() => { if (!isRead) void onMarkRead(notification.id); }}
    >
      {/* Icon */}
      <div className="mt-0.5 shrink-0">
        {isInvite ? (
          <ProfileAvatar type="community" src={null} name={meta?.communityName as string ?? "Community"} size="sm" />
        ) : (
          <div className="flex items-center justify-center size-8 rounded-full bg-muted">
            <Bell className="size-3.5 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm", !isRead && "font-medium")}>
          {notification.title}
        </p>
        {notification.message && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {notification.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground/60 mt-1">
          {formatRelativeTime(notification.createdAt)}
        </p>

        {/* Invite actions */}
        {isInvite && invitationId && !actionTaken && (
          <div className="flex items-center gap-2 mt-2">
            <Button
              size="xs"
              onClick={(e) => { e.stopPropagation(); void handleAccept(); }}
              disabled={isActing}
              className="gap-1"
            >
              <Check className="size-3" />
              Accept
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={(e) => { e.stopPropagation(); void handleDecline(); }}
              disabled={isActing}
            >
              Decline
            </Button>
          </div>
        )}

        {actionTaken && (
          <p className="text-xs text-muted-foreground mt-2">
            {actionTaken === "accepted" ? "Invitation accepted" : "Invitation declined"}
          </p>
        )}
      </div>

      {/* Unread dot */}
      {!isRead && (
        <div className="mt-2 size-2 rounded-full bg-primary shrink-0" />
      )}
    </div>
  );
}

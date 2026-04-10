"use client";

import { Bell } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "./notification-provider";

export function NotificationButton({ className, disabled }: { className?: string; disabled?: boolean }) {
  const { unreadCount, toggleOpen, isOpen } = useNotifications();

  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          data-tour="notifications"
          onClick={disabled ? undefined : toggleOpen}
          disabled={disabled}
          type="button"
          className={cn(
            "relative flex items-center justify-center",
            "size-8 rounded-full",
            "text-muted-foreground",
            "transition-all duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            disabled
              ? "opacity-50 cursor-not-allowed"
              : "cursor-pointer hover:bg-input/50 hover:text-foreground",
            isOpen && !disabled && "text-foreground",
            className,
          )}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && !disabled && (
            <Badge
              variant="solid"
              className="absolute -top-1 -right-1 min-w-5 h-5 px-1.5 text-[10px] font-semibold border-2 border-background"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        <p className="text-xs">
          {disabled
            ? "Sign in to see notifications"
            : unreadCount > 0
              ? `${unreadCount} new notification${unreadCount !== 1 ? "s" : ""}`
              : "No new notifications"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

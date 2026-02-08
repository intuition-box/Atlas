"use client";

import { ProfileAvatar } from "@/components/common/profile-avatar";
import { Button } from "@/components/ui/button";
import { AttestationButtons } from "@/components/attestation/attestation-buttons";
import type { SimulatedNode } from "./types";

/* ────────────────────────────
   Helpers
──────────────────────────── */

function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;

  const diff = Date.now() - ts;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Active today";
  if (days === 1) return "Active yesterday";
  if (days < 7) return `Active ${days} days ago`;
  if (days < 30) return `Active ${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `Active ${Math.floor(days / 30)} months ago`;
  return `Active ${Math.floor(days / 365)} years ago`;
}

/* ────────────────────────────
   Tooltip — shown on hover
   Lightweight: name + scores
──────────────────────────── */

export interface NodeTooltipProps {
  node: SimulatedNode;
  x: number;
  y: number;
  containerRect: DOMRect;
}

export function NodeTooltip({ node, x, y, containerRect }: NodeTooltipProps) {
  const padding = 12;
  const tooltipW = 140;
  const tooltipH = 52;

  let left = x - containerRect.left + 16;
  let top = y - containerRect.top + 16;

  // Flip if overflowing right
  if (left + tooltipW > containerRect.width - padding) {
    left = x - containerRect.left - tooltipW - 16;
  }
  // Flip if overflowing bottom
  if (top + tooltipH > containerRect.height - padding) {
    top = y - containerRect.top - tooltipH - 16;
  }
  // Clamp to container
  if (left < padding) left = padding;
  if (top < padding) top = padding;

  return (
    <div
      className="pointer-events-none absolute z-50 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-md"
      style={{ left, top }}
    >
      <div className="text-sm font-medium text-foreground">{node.name}</div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span>Love: {node.loveScore}</span>
        <span>Reach: {node.reachScore}</span>
      </div>
    </div>
  );
}

/* ────────────────────────────
   Popover — shown on click
   Rich: avatar, name, handle, location,
   last active, attestation, view profile
──────────────────────────── */

export interface NodePopoverProps {
  node: SimulatedNode;
  x: number;
  y: number;
  onClose: () => void;
  onViewProfile: (memberId: string) => void;
}

export function NodePopover({ node, x, y, onClose, onViewProfile }: NodePopoverProps) {
  const lastActive = formatRelativeTime(node.lastActiveAt);

  // Position with overflow protection
  const left = Math.min(x, window.innerWidth - 300);
  const top = Math.min(y + 10, window.innerHeight - 320);

  return (
    <>
      {/* Backdrop — click to close */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Card */}
      <div
        className="fixed z-50 w-72 rounded-2xl border border-border bg-popover p-4 shadow-2xl flex flex-col gap-4"
        style={{ left, top }}
      >
        {/* Avatar */}
        <div className="flex justify-center">
          <ProfileAvatar
            type="user"
            src={node.avatarUrl}
            name={node.name}
            className="size-16"
          />
        </div>

        {/* Name & Handle */}
        <div className="text-center">
          <div className="text-base font-semibold text-foreground">{node.name}</div>
          {node.handle && (
            <div className="text-sm text-muted-foreground">@{node.handle}</div>
          )}
        </div>

        {/* Details */}
        {(lastActive || node.location) && (
          <div className="space-y-1 text-sm text-muted-foreground text-center">
            {lastActive && <div>{lastActive}</div>}
            {node.location && <div>{node.location}</div>}
          </div>
        )}

        {/* Attestation Buttons */}
        <AttestationButtons
          toUserId={node.id}
          toName={node.name}
          toHandle={node.handle ?? undefined}
          toAvatarUrl={node.avatarUrl}
          className="justify-center"
        />

        {/* View Profile */}
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => onViewProfile(node.id)}
        >
          View Profile
        </Button>
      </div>
    </>
  );
}

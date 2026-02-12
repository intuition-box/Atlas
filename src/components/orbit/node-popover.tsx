"use client";

import * as React from "react";

import { ProfileAvatar } from "@/components/common/profile-avatar";
import { Button } from "@/components/ui/button";
import {
  UsersIcon,
  UserIcon,
  CheckIcon,
  PlusIcon,
  GlobeIcon,
  LockClosedIcon,
  LockOpenIcon,
} from "@/components/ui/icons";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { AttestationButtons } from "@/components/attestation/buttons";
import { LEVEL_COLORS } from "./constants";
import type { SimulatedNode } from "./types";

/* ────────────────────────────
   Virtual anchor helper
──────────────────────────── */

function useCircleAnchor(x: number, y: number, radius: number) {
  return React.useMemo(
    () => ({
      getBoundingClientRect: () => ({
        x: x - radius,
        y: y - radius,
        width: radius * 2,
        height: radius * 2,
        top: y - radius,
        right: x + radius,
        bottom: y + radius,
        left: x - radius,
      }),
    }),
    [x, y, radius],
  );
}

/* ────────────────────────────
   Helpers
──────────────────────────── */

function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;

  const diff = Date.now() - ts;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Last seen today";
  if (days === 1) return "Last seen yesterday";
  if (days < 7) return `Last seen ${days} days ago`;
  if (days < 30) return `Last seen ${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `Last seen ${Math.floor(days / 30)} months ago`;
  return `Last seen ${Math.floor(days / 365)} years ago`;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

/* ────────────────────────────
   NodeTooltip

   Single tooltip component for every canvas node:
   community bubbles, orbit members, center avatar.
   Caller provides content via children.
──────────────────────────── */

export interface NodeTooltipProps {
  x: number;
  y: number;
  screenRadius: number;
  className?: string;
  children: React.ReactNode;
}

export function NodeTooltip({
  x,
  y,
  screenRadius,
  className,
  children,
}: NodeTooltipProps) {
  const anchor = useCircleAnchor(x, y, screenRadius);

  return (
    <Tooltip open>
      <TooltipContent
        anchor={anchor}
        side="top"
        sideOffset={4}
        positionerClassName="pointer-events-none"
        className={`pointer-events-none ${className ?? ""}`}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

/* ────────────────────────────
   NodePopover

   Single popover component for every canvas node.
   Caller provides content via children.
──────────────────────────── */

export interface NodePopoverProps {
  x: number;
  y: number;
  screenRadius: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function NodePopover({
  x,
  y,
  screenRadius,
  onClose,
  children,
}: NodePopoverProps) {
  const anchor = useCircleAnchor(x, y, screenRadius);

  return (
    <Popover open>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <PopoverContent anchor={anchor} side="top" sideOffset={16} align="center">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/* ────────────────────────────
   Pre-built content: community tooltip
   Used for both universe bubbles and orbit center avatar.
──────────────────────────── */

export interface CommunityTooltipContentProps {
  name: string;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
}

export function CommunityTooltipContent({
  name,
  memberCount,
  isPublic,
  isMembershipOpen,
}: CommunityTooltipContentProps) {
  return (
    <>
      <div className="font-semibold text-sm">{name}</div>
      <div className="mt-2 flex flex-col gap-1.5 opacity-85">
        <div className="flex items-center gap-2">
          <UsersIcon className="size-3.5 shrink-0" />
          <span>
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <UserIcon className="size-3.5 shrink-0" />
          <span>{isPublic ? "Public" : "Private"} community</span>
        </div>
        <div className="flex items-center gap-2">
          {isMembershipOpen ? (
            <CheckIcon className="size-3.5 shrink-0" />
          ) : (
            <PlusIcon className="size-3.5 shrink-0" />
          )}
          <span>{isMembershipOpen ? "Open" : "Closed"} membership</span>
        </div>
      </div>
    </>
  );
}

/* ────────────────────────────
   Pre-built content: member tooltip
──────────────────────────── */

export function MemberTooltipContent({ node }: { node: SimulatedNode }) {
  return (
    <>
      <div className="text-sm font-medium">{node.name}</div>
      <div className="mt-1 flex items-center gap-3 text-xs opacity-80">
        <span>Love: {node.loveScore}</span>
        <span>Reach: {node.reachScore}</span>
      </div>
    </>
  );
}

/* ────────────────────────────
   Pre-built content: orbit member popover
──────────────────────────── */

export interface MemberPopoverContentProps {
  node: SimulatedNode;
  onViewProfile: (memberId: string) => void;
}

export function MemberPopoverContent({
  node,
  onViewProfile,
}: MemberPopoverContentProps) {
  const joined = fmtDate(node.joinedAt ?? null);
  const lastSeen = formatRelativeTime(node.lastActiveAt ?? null);

  return (
    <>
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
        <div className="text-base font-semibold text-foreground">
          {node.name}
        </div>
        {node.handle && (
          <div className="text-sm text-muted-foreground">@{node.handle}</div>
        )}
      </div>

      {/* Details */}
      {(joined || lastSeen || node.location) && (
        <div className="space-y-1 text-sm text-muted-foreground text-center">
          {joined && <div>Joined {joined}</div>}
          {lastSeen && <div>{lastSeen}</div>}
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
        onClick={() => onViewProfile(node.handle ?? node.id)}
      >
        View Profile
      </Button>
    </>
  );
}

/* ────────────────────────────
   Pre-built content: community popover
──────────────────────────── */

export interface CommunityPopoverData {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string | null;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  orbitStats: {
    advocates: number;
    contributors: number;
    participants: number;
    explorers: number;
  };
  description?: string | null;
  viewerMembership: { status: string; role: string } | null;
}

export function CommunityPopoverContent({
  community,
}: {
  community: CommunityPopoverData;
}) {
  const MembershipIcon = community.isMembershipOpen
    ? LockOpenIcon
    : LockClosedIcon;
  const VisibilityIcon = community.isPublic ? GlobeIcon : LockClosedIcon;

  return (
    <>
      {/* Avatar */}
      <div className="flex justify-center">
        <ProfileAvatar
          type="community"
          src={community.avatarUrl}
          name={community.name}
          className="size-16"
        />
      </div>

      {/* Name & Handle */}
      <div className="text-center">
        <div className="text-base font-semibold text-foreground">
          {community.name}
        </div>
        <div className="text-sm text-muted-foreground">
          @{community.handle}
        </div>
      </div>

      {/* Description */}
      {community.description && (
        <p className="text-sm text-muted-foreground text-center line-clamp-3">
          {community.description}
        </p>
      )}

      {/* Info pills */}
      <div className="flex flex-wrap justify-center gap-2">
        <div className="flex items-center gap-1 rounded-full bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
          <UsersIcon className="size-3" />
          <span>{community.memberCount} members</span>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
          <VisibilityIcon className="size-3" />
          <span>{community.isPublic ? "Public" : "Private"}</span>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
          <MembershipIcon className="size-3" />
          <span>{community.isMembershipOpen ? "Open" : "Closed"}</span>
        </div>
      </div>

      {/* Orbit stats bar */}
      <OrbitStatsBar
        stats={community.orbitStats}
        total={community.memberCount}
      />

      {/* Viewer membership status */}
      {community.viewerMembership && (
        <div className="text-center text-xs text-muted-foreground">
          {community.viewerMembership.status === "ACTIVE" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-primary">
              {community.viewerMembership.role === "ADMIN"
                ? "Admin"
                : "Member"}
            </span>
          ) : community.viewerMembership.status === "PENDING" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2.5 py-1">
              Application pending
            </span>
          ) : null}
        </div>
      )}
    </>
  );
}

/* ────────────────────────────
   OrbitStatsBar (internal)
──────────────────────────── */

function OrbitStatsBar({
  stats,
  total,
}: {
  stats: CommunityPopoverData["orbitStats"];
  total: number;
}) {
  if (total === 0) return null;

  const segments = [
    { key: "advocates", count: stats.advocates, color: LEVEL_COLORS.ADVOCATE },
    {
      key: "contributors",
      count: stats.contributors,
      color: LEVEL_COLORS.CONTRIBUTOR,
    },
    {
      key: "participants",
      count: stats.participants,
      color: LEVEL_COLORS.PARTICIPANT,
    },
    { key: "explorers", count: stats.explorers, color: LEVEL_COLORS.EXPLORER },
  ] as const;

  return (
    <div className="space-y-2">
      {/* Bar */}
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
        {segments.map((seg) => {
          const pct = (seg.count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={seg.key}
              className="h-full"
              style={{ width: `${pct}%`, backgroundColor: seg.color }}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {segments.map((seg) => {
          if (seg.count === 0) return null;
          return (
            <div
              key={seg.key}
              className="flex items-center gap-1 text-xs text-muted-foreground"
            >
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              <span>{seg.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

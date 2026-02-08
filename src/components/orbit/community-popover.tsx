"use client";

import { ProfileAvatar } from "@/components/common/profile-avatar";
import { UsersIcon, GlobeIcon, LockClosedIcon, LockOpenIcon } from "@/components/ui/icons";
import { LEVEL_COLORS } from "./constants";

/* ────────────────────────────
   Types
──────────────────────────── */

export interface CommunityPopoverProps {
  community: {
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
  };
  x: number;
  y: number;
  onClose: () => void;
}

/* ────────────────────────────
   Orbit stats bar
──────────────────────────── */

function OrbitStatsBar({
  stats,
  total,
}: {
  stats: CommunityPopoverProps["community"]["orbitStats"];
  total: number;
}) {
  if (total === 0) return null;

  const segments = [
    { key: "advocates", count: stats.advocates, color: LEVEL_COLORS.ADVOCATE },
    { key: "contributors", count: stats.contributors, color: LEVEL_COLORS.CONTRIBUTOR },
    { key: "participants", count: stats.participants, color: LEVEL_COLORS.PARTICIPANT },
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
            <div key={seg.key} className="flex items-center gap-1 text-xs text-muted-foreground">
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

/* ────────────────────────────
   Component
──────────────────────────── */

export function CommunityPopover({ community, x, y, onClose }: CommunityPopoverProps) {
  // Position with overflow protection
  const left = Math.min(x, window.innerWidth - 300);
  const top = Math.min(y + 10, window.innerHeight - 400);

  const MembershipIcon = community.isMembershipOpen ? LockOpenIcon : LockClosedIcon;
  const VisibilityIcon = community.isPublic ? GlobeIcon : LockClosedIcon;

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
            type="community"
            src={community.avatarUrl}
            name={community.name}
            className="size-16"
          />
        </div>

        {/* Name & Handle */}
        <div className="text-center">
          <div className="text-base font-semibold text-foreground">{community.name}</div>
          <div className="text-sm text-muted-foreground">@{community.handle}</div>
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
        <OrbitStatsBar stats={community.orbitStats} total={community.memberCount} />

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
      </div>
    </>
  );
}

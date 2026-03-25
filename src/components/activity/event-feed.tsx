"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { ArrowUpRight } from "lucide-react";

import { formatRelativeTime, displayName } from "@/lib/format";
import { userPath } from "@/lib/routes";
import { ATTESTATION_TYPES, type AttestationType } from "@/lib/attestations/definitions";
import { AttestationBadge } from "@/components/attestation/badge";

import { ListFeed, ListFeedSkeleton, ListFeedEmpty } from "@/components/common/list-feed";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { Badge } from "@/components/ui/badge";

// ── Types ──────────────────────────────────────────────────────────

export type ActivityUser = {
  id: string;
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type ActivityEvent = {
  id: string;
  type: string;
  createdAt: string;
  actor: ActivityUser;
  subject: ActivityUser | null;
  metadata: Record<string, unknown> | null;
};

export type EventTypeConfig = {
  label: string;
  variant: "default" | "positive" | "info" | "destructive" | "secondary" | "outline";
};

// ── Default event type config ──────────────────────────────────────

const DEFAULT_EVENT_TYPE_CONFIG: Record<string, EventTypeConfig> = {
  JOINED: { label: "Joined", variant: "positive" },
  ATTESTED: { label: "Attestation", variant: "default" },
  ATTESTATION_RETRACTED: { label: "Removed", variant: "destructive" },
  ATTESTATION_SUPERSEDED: { label: "Attestation Updated", variant: "secondary" },
  ROLE_UPDATED: { label: "Role Change", variant: "info" },
  ORBIT_OVERRIDE: { label: "Orbit Override", variant: "info" },
};

// ── Props ──────────────────────────────────────────────────────────

export interface EventFeedProps {
  events: ActivityEvent[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  /** Merge with (or override) the default event type config. */
  eventTypeConfig?: Record<string, EventTypeConfig>;
  /** Custom renderer per event. Return `null` to fall back to default. */
  renderEvent?: (event: ActivityEvent) => ReactNode | null;
  /** Extra info rendered after the description (e.g. community context). */
  renderExtra?: (event: ActivityEvent) => ReactNode | null;
  emptyMessage?: string;
  className?: string;
}

// ── Shared sub-components ──────────────────────────────────────────

export function UserLink({ user }: { user: ActivityUser }) {
  const name = displayName(user);
  const href = user.handle ? userPath(user.handle) : "#";

  return (
    <Link
      href={href}
      className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
    >
      <ProfileAvatar type="user" src={user.avatarUrl} name={name} size="sm" />
      <span className="truncate text-sm font-medium">{name}</span>
    </Link>
  );
}

function EventTypeBadge({
  type,
  config,
}: {
  type: string;
  config: Record<string, EventTypeConfig>;
}) {
  const c = config[type];
  if (!c) return <Badge variant="secondary">{type}</Badge>;
  return (
    <Badge variant={c.variant} className="shrink-0">
      {c.label}
    </Badge>
  );
}

// ── Event row renderers ────────────────────────────────────────────

function JoinedEventRow({
  event,
  config,
  extra,
}: {
  event: ActivityEvent;
  config: Record<string, EventTypeConfig>;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.actor} />
        <span className="text-muted-foreground shrink-0">joined the community</span>
        {extra}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <EventTypeBadge type={event.type} config={config} />
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    </div>
  );
}

function AttestationEventRow({
  event,
  config,
  extra,
}: {
  event: ActivityEvent;
  config: Record<string, EventTypeConfig>;
  extra?: ReactNode;
}) {
  const attestationType = (event.metadata?.attestationType as string) ?? null;
  const stance = (event.metadata?.stance as string) ?? "for";

  // For retraction events, show "Withdrawn" for minted attestations, "Removed" for pending
  const retractLabel =
    event.type === "ATTESTATION_RETRACTED" && event.metadata?.minted === true
      ? "Withdrawn"
      : null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.actor} />
        <ArrowUpRight className="size-3 shrink-0 text-amber-500" />
        {event.subject ? (
          <UserLink user={event.subject} />
        ) : (
          <span className="text-muted-foreground">unknown</span>
        )}
        <Badge
          variant={stance === "against" ? "destructive" : "positive"}
          className="text-[10px] px-1.5 py-0"
        >
          {stance === "against" ? "Oppose" : "Support"}
        </Badge>
        {attestationType && attestationType in ATTESTATION_TYPES && (
          <AttestationBadge type={attestationType as AttestationType} />
        )}
        {extra}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {retractLabel ? (
          <Badge variant="destructive" className="shrink-0">{retractLabel}</Badge>
        ) : (
          <EventTypeBadge type={event.type} config={config} />
        )}
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    </div>
  );
}

function RoleUpdatedEventRow({
  event,
  config,
  extra,
}: {
  event: ActivityEvent;
  config: Record<string, EventTypeConfig>;
  extra?: ReactNode;
}) {
  const toRole = (event.metadata?.toRole as string) ?? null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        {event.subject ? (
          <UserLink user={event.subject} />
        ) : (
          <UserLink user={event.actor} />
        )}
        <span className="text-muted-foreground shrink-0">
          role changed{toRole ? ` to ${toRole.toLowerCase()}` : ""}
        </span>
        {extra}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <EventTypeBadge type={event.type} config={config} />
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    </div>
  );
}

function GenericEventRow({
  event,
  config,
  extra,
}: {
  event: ActivityEvent;
  config: Record<string, EventTypeConfig>;
  extra?: ReactNode;
}) {
  const description =
    event.type === "ORBIT_OVERRIDE"
      ? "orbit level updated"
      : event.type === "ATTESTATION_SUPERSEDED"
        ? "updated an attestation"
        : event.type.toLowerCase().replace(/_/g, " ");

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.actor} />
        <span className="text-muted-foreground shrink-0">{description}</span>
        {event.subject && (
          <>
            <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
            <UserLink user={event.subject} />
          </>
        )}
        {extra}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <EventTypeBadge type={event.type} config={config} />
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    </div>
  );
}

function DefaultEventRow({
  event,
  config,
  extra,
}: {
  event: ActivityEvent;
  config: Record<string, EventTypeConfig>;
  extra?: ReactNode;
}) {
  switch (event.type) {
    case "JOINED":
      return <JoinedEventRow event={event} config={config} extra={extra} />;
    case "ATTESTED":
    case "ATTESTATION_RETRACTED":
      return <AttestationEventRow event={event} config={config} extra={extra} />;
    case "ROLE_UPDATED":
      return <RoleUpdatedEventRow event={event} config={config} extra={extra} />;
    default:
      return <GenericEventRow event={event} config={config} extra={extra} />;
  }
}

// ── Skeleton (kept for backwards compat) ───────────────────────────

export function EventFeedSkeleton({ rows = 5 }: { rows?: number }) {
  return <ListFeedSkeleton rows={rows} />;
}

// ── Empty state (kept for backwards compat) ────────────────────────

export function EventFeedEmpty({ message = "No activity yet." }: { message?: string }) {
  return <ListFeedEmpty message={message} />;
}

// ── Main component ─────────────────────────────────────────────────

export function EventFeed({
  events,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  eventTypeConfig,
  renderEvent,
  renderExtra,
  emptyMessage = "No activity yet.",
  className,
}: EventFeedProps) {
  const config = eventTypeConfig
    ? { ...DEFAULT_EVENT_TYPE_CONFIG, ...eventTypeConfig }
    : DEFAULT_EVENT_TYPE_CONFIG;

  return (
    <ListFeed<ActivityEvent>
      items={events}
      keyExtractor={(e) => e.id}
      renderItem={(event) => {
        if (renderEvent) {
          const custom = renderEvent(event);
          if (custom !== null) return <>{custom}</>;
        }
        const extra = renderExtra?.(event) ?? null;
        return <DefaultEventRow event={event} config={config} extra={extra} />;
      }}
      loading={loading}
      loadingMore={loadingMore}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      emptyMessage={emptyMessage}
      className={className}
    />
  );
}

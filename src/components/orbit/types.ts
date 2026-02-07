import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";

/* ────────────────────────────
   Domain Types
──────────────────────────── */

export type OrbitLevel = "ADVOCATE" | "CONTRIBUTOR" | "PARTICIPANT" | "EXPLORER";

export type OrbitMember = {
  id: string;
  handle?: string | null;
  name: string;
  avatarUrl?: string | null;
  headline?: string | null;
  location?: string | null;
  tags?: string[];
  orbitLevel: OrbitLevel;
  loveScore: number;
  reachScore: number;
  lastActiveAt?: string | null;
};

export type MemberLink = {
  source: string;
  target: string;
  weight?: number;
};

/* ────────────────────────────
   Simulation Types
──────────────────────────── */

export interface SimulatedNode extends SimulationNodeDatum {
  id: string;
  handle: string | null;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  location: string | null;
  tags: string[];
  orbitLevel: OrbitLevel;
  loveScore: number;
  reachScore: number;
  lastActiveAt: string | null;
  radius: number;
  color: string;
  /** Position on the ellipse as fraction of total perimeter (0–1) */
  baseT: number;
}

export interface SimulatedLink extends SimulationLinkDatum<SimulatedNode> {
  weight: number;
}

/* ────────────────────────────
   Component Props Types
──────────────────────────── */

export type OrbitViewProps = {
  members: OrbitMember[];
  links?: MemberLink[];
  centerLogoUrl?: string | null;
  centerName?: string;
  isMembershipOpen?: boolean;
  isPublicDirectory?: boolean;
  onMemberClick?: (memberId: string) => void;
  className?: string;
};

export type TooltipState = {
  node: SimulatedNode;
  x: number;
  y: number;
} | null;

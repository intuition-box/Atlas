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
  joinedAt?: string | null;
};

export type MemberLink = {
  source: string;
  target: string;
  weight?: number;
};

/* ────────────────────────────
   Universe Types
──────────────────────────── */

/** Community bubble data for the universe view */
export type OrbitCommunity = {
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
    dominantLevel: "advocates" | "contributors" | "participants" | "explorers";
  };
};

/** Link between two communities (shared members) */
export type OrbitLink = {
  source: string;
  target: string;
  sharedMembers: number;
};

/* ────────────────────────────
   Simulation Types
──────────────────────────── */

export interface SimulatedNode extends SimulationNodeDatum {
  id: string;
  handle?: string | null;
  name: string;
  avatarUrl?: string | null;
  headline?: string | null;
  location?: string | null;
  tags: string[];
  orbitLevel: OrbitLevel;
  loveScore: number;
  reachScore: number;
  lastActiveAt?: string | null;
  joinedAt?: string | null;
  radius: number;
  color: string;
  /** Position on the ellipse as fraction of total perimeter (0–1) */
  baseT: number;
  /** Angle in radians along the ellipse based on baseT (0–1) */
  readonly baseAngle?: number;
}

export interface SimulatedLink extends SimulationLinkDatum<SimulatedNode> {
  weight?: number;
}

/* ────────────────────────────
   Component Props Types
──────────────────────────── */

/** Community data shown in the center avatar popover */
export type OrbitCommunityData = {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string | null;
  description?: string | null;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  isAdmin?: boolean;
  viewerMembership?: { status: string; role: string } | null;
};

export type OrbitViewProps = {
  members: OrbitMember[];
  links?: MemberLink[];
  /** Logo image URL to render in the center */
  centerLogoUrl?: string | null;
  /** Optional text label at the center of the orbit */
  centerName?: string;
  isMembershipOpen?: boolean;
  isPublicDirectory?: boolean;
  /** Community data for the center avatar popover */
  community?: OrbitCommunityData;
  /** When true, nodes start at center and expand outward */
  startFromCenter?: boolean;
  /** Called when a member node is clicked */
  onMemberClick?: (memberId: string) => void;
  className?: string;
};

export type TooltipState = {
  node: SimulatedNode;
  x: number;
  y: number;
  screenRadius: number;
} | null;

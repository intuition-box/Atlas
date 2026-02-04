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
  ring: number;
  radius: number;
  color: string;
  /** Base angle for rotation animation (radians) */
  baseAngle: number;
}

export interface SimulatedLink extends SimulationLinkDatum<SimulatedNode> {
  weight: number;
}

/* ────────────────────────────
   Component Props Types
──────────────────────────── */

export type OrbitCanvasProps = {
  nodes: SimulatedNode[];
  links: SimulatedLink[];
  width: number;
  height: number;
  centerLogoUrl?: string | null;
  centerName?: string;
  /** Whether membership is open (accepting applications) */
  isMembershipOpen?: boolean;
  /** Whether the directory is publicly visible */
  isPublicDirectory?: boolean;
  onNodeClick?: (node: SimulatedNode, position: { x: number; y: number }) => void;
  onNodeHover?: (node: SimulatedNode | null, position: { x: number; y: number }) => void;
  onNodeDragStart?: (nodeId: string) => void;
  onNodeDrag?: (nodeId: string, x: number, y: number) => void;
  onNodeDragEnd?: (nodeId: string) => void;
  onHoverChange?: (isHovering: boolean) => void;
  className?: string;
};

export type OrbitViewProps = {
  members: OrbitMember[];
  links?: MemberLink[];
  centerLogoUrl?: string | null;
  centerName?: string;
  /** Whether membership is open (accepting applications) */
  isMembershipOpen?: boolean;
  /** Whether the directory is publicly visible */
  isPublicDirectory?: boolean;
  onMemberClick?: (memberId: string) => void;
  onMemberAttest?: (memberId: string) => void;
  className?: string;
};

export type TooltipState = {
  node: SimulatedNode;
  x: number;
  y: number;
} | null;

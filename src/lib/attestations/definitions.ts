/**
 * Attestation & Attribute Definitions
 *
 * Single source of truth for:
 * - Attestation types (FOLLOW, TRUST, etc.) with blockchain predicates
 * - Attributes (skills, tools) with blockchain predicates
 *
 * Attestations are user-to-user signals (global, not scoped to communities).
 * Attributes are things users can have/claim (skills, tools).
 *
 * Each type has a corresponding blockchain predicate for on-chain minting.
 * Offchain (DB) and onchain (Intuition) are just different states.
 */

/* ────────────────────────────
   Attestation Types
──────────────────────────── */

export const ATTESTATION_TYPES = {
  FOLLOW: {
    id: "FOLLOW",
    label: "I Follow",
    description: "Get notifications and updates about this user",
    predicate: "orbyt:follow",
  },
  TRUST: {
    id: "TRUST",
    label: "I Trust",
    description: "Influences reputation score (love and reach)",
    predicate: "orbyt:trust",
  },
  KNOW_IRL: {
    id: "KNOW_IRL",
    label: "I Know IRL",
    description: "Opportunities for physical events and hackathons",
    predicate: "orbyt:know_irl",
  },
  WORK_WITH: {
    id: "WORK_WITH",
    label: "I Work With",
    description: "Collaborate and code together",
    predicate: "orbyt:work_with",
  },
  MET: {
    id: "MET",
    label: "I Met",
    description: "Having meetings and calls to discuss",
    predicate: "orbyt:met",
  },
} as const;

export type AttestationType = keyof typeof ATTESTATION_TYPES;

export const ATTESTATION_TYPE_LIST = Object.values(ATTESTATION_TYPES);

/**
 * Get the blockchain predicate for an attestation type.
 * Used when minting attestations on-chain via Intuition SDK.
 */
export function getPredicateForType(type: AttestationType): string {
  return ATTESTATION_TYPES[type].predicate;
}

/* ────────────────────────────
   Attributes (Skills + Tools)
──────────────────────────── */

/**
 * User Attributes Configuration
 *
 * Attributes are things users can have/claim (skills, tools).
 * These are object atoms in Intuition - can be used in triples like:
 *   [User] → [has_attribute] → [Attribute]
 *
 * Future: Other users can endorse these attributes.
 */

export const ATTRIBUTES = {
  // Skills
  engineering: {
    id: "engineering",
    label: "Engineering",
    category: "skill",
    predicate: "orbyt:attr:engineering",
  },
  design: {
    id: "design",
    label: "Design",
    category: "skill",
    predicate: "orbyt:attr:design",
  },
  product: {
    id: "product",
    label: "Product",
    category: "skill",
    predicate: "orbyt:attr:product",
  },
  marketing: {
    id: "marketing",
    label: "Marketing",
    category: "skill",
    predicate: "orbyt:attr:marketing",
  },
  community: {
    id: "community",
    label: "Community",
    category: "skill",
    predicate: "orbyt:attr:community",
  },

  // Tools
  vscode: {
    id: "vscode",
    label: "VS Code",
    category: "tool",
    predicate: "orbyt:attr:vscode",
  },
  notion: {
    id: "notion",
    label: "Notion",
    category: "tool",
    predicate: "orbyt:attr:notion",
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    category: "tool",
    predicate: "orbyt:attr:chatgpt",
  },
  figma: {
    id: "figma",
    label: "Figma",
    category: "tool",
    predicate: "orbyt:attr:figma",
  },
  github: {
    id: "github",
    label: "GitHub",
    category: "tool",
    predicate: "orbyt:attr:github",
  },
  davinci: {
    id: "davinci",
    label: "DaVinci Resolve",
    category: "tool",
    predicate: "orbyt:attr:davinci",
  },
} as const;

export type AttributeId = keyof typeof ATTRIBUTES;
export type AttributeCategory = "skill" | "tool";
export type Attribute = (typeof ATTRIBUTES)[AttributeId];

// Filtered lists for UI
export const SKILLS = Object.values(ATTRIBUTES).filter(
  (a): a is Attribute & { category: "skill" } => a.category === "skill"
);
export const TOOLS = Object.values(ATTRIBUTES).filter(
  (a): a is Attribute & { category: "tool" } => a.category === "tool"
);

// String arrays for backward compatibility with existing UI
export const SKILL_LIST = SKILLS.map((s) => s.label);
export const TOOL_LIST = TOOLS.map((t) => t.label);

// Legacy type exports for backward compatibility
export type Skill = string;
export type Tool = string;

/**
 * Get the blockchain predicate for an attribute.
 * Used when creating attribute atoms on-chain via Intuition SDK.
 */
export function getAttributePredicate(id: AttributeId): string {
  return ATTRIBUTES[id].predicate;
}

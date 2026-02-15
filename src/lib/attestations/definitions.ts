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
    predicate: "atlas:follow",
  },
  TRUST: {
    id: "TRUST",
    label: "I Trust",
    description: "Influences reputation score (love and reach)",
    predicate: "atlas:trust",
  },
  KNOW_IRL: {
    id: "KNOW_IRL",
    label: "I Know IRL",
    description: "Opportunities for physical events and hackathons",
    predicate: "atlas:know_irl",
  },
  WORK_WITH: {
    id: "WORK_WITH",
    label: "I Work With",
    description: "Collaborate and code together",
    predicate: "atlas:work_with",
  },
  MET: {
    id: "MET",
    label: "I Met",
    description: "Having meetings and calls to discuss",
    predicate: "atlas:met",
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
    predicate: "atlas:attr:engineering",
  },
  design: {
    id: "design",
    label: "Design",
    category: "skill",
    predicate: "atlas:attr:design",
  },
  product: {
    id: "product",
    label: "Product",
    category: "skill",
    predicate: "atlas:attr:product",
  },
  marketing: {
    id: "marketing",
    label: "Marketing",
    category: "skill",
    predicate: "atlas:attr:marketing",
  },
  community: {
    id: "community",
    label: "Community",
    category: "skill",
    predicate: "atlas:attr:community",
  },
  research: {
    id: "research",
    label: "Research",
    category: "skill",
    predicate: "atlas:attr:research",
  },
  writing: {
    id: "writing",
    label: "Writing",
    category: "skill",
    predicate: "atlas:attr:writing",
  },
  dataScience: {
    id: "dataScience",
    label: "Data Science",
    category: "skill",
    predicate: "atlas:attr:data_science",
  },
  security: {
    id: "security",
    label: "Security",
    category: "skill",
    predicate: "atlas:attr:security",
  },
  devrel: {
    id: "devrel",
    label: "DevRel",
    category: "skill",
    predicate: "atlas:attr:devrel",
  },
  projectManagement: {
    id: "projectManagement",
    label: "Project Management",
    category: "skill",
    predicate: "atlas:attr:project_management",
  },
  smartContracts: {
    id: "smartContracts",
    label: "Smart Contracts",
    category: "skill",
    predicate: "atlas:attr:smart_contracts",
  },
  trading: {
    id: "trading",
    label: "Trading",
    category: "skill",
    predicate: "atlas:attr:trading",
  },

  // Tools
  vscode: {
    id: "vscode",
    label: "VS Code",
    category: "tool",
    predicate: "atlas:attr:vscode",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    category: "tool",
    predicate: "atlas:attr:cursor",
  },
  claude: {
    id: "claude",
    label: "Claude",
    category: "tool",
    predicate: "atlas:attr:claude",
  },
  notion: {
    id: "notion",
    label: "Notion",
    category: "tool",
    predicate: "atlas:attr:notion",
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    category: "tool",
    predicate: "atlas:attr:chatgpt",
  },
  figma: {
    id: "figma",
    label: "Figma",
    category: "tool",
    predicate: "atlas:attr:figma",
  },
  github: {
    id: "github",
    label: "GitHub",
    category: "tool",
    predicate: "atlas:attr:github",
  },
  davinci: {
    id: "davinci",
    label: "DaVinci Resolve",
    category: "tool",
    predicate: "atlas:attr:davinci",
  },
  linear: {
    id: "linear",
    label: "Linear",
    category: "tool",
    predicate: "atlas:attr:linear",
  },
  discord: {
    id: "discord",
    label: "Discord",
    category: "tool",
    predicate: "atlas:attr:discord",
  },
  telegram: {
    id: "telegram",
    label: "Telegram",
    category: "tool",
    predicate: "atlas:attr:telegram",
  },
  dune: {
    id: "dune",
    label: "Dune",
    category: "tool",
    predicate: "atlas:attr:dune",
  },
  remix: {
    id: "remix",
    label: "Remix IDE",
    category: "tool",
    predicate: "atlas:attr:remix",
  },
  hardhat: {
    id: "hardhat",
    label: "Hardhat",
    category: "tool",
    predicate: "atlas:attr:hardhat",
  },
  foundry: {
    id: "foundry",
    label: "Foundry",
    category: "tool",
    predicate: "atlas:attr:foundry",
  },
  vercel: {
    id: "vercel",
    label: "Vercel",
    category: "tool",
    predicate: "atlas:attr:vercel",
  },
  arc: {
    id: "arc",
    label: "Arc",
    category: "tool",
    predicate: "atlas:attr:arc",
  },
  obsidian: {
    id: "obsidian",
    label: "Obsidian",
    category: "tool",
    predicate: "atlas:attr:obsidian",
  },
  blender: {
    id: "blender",
    label: "Blender",
    category: "tool",
    predicate: "atlas:attr:blender",
  },
  photoshop: {
    id: "photoshop",
    label: "Photoshop",
    category: "tool",
    predicate: "atlas:attr:photoshop",
  },
  canva: {
    id: "canva",
    label: "Canva",
    category: "tool",
    predicate: "atlas:attr:canva",
  },
  slack: {
    id: "slack",
    label: "Slack",
    category: "tool",
    predicate: "atlas:attr:slack",
  },
  miro: {
    id: "miro",
    label: "Miro",
    category: "tool",
    predicate: "atlas:attr:miro",
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

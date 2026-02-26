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
    emoji: "👀",
    description: "Get notifications and updates about this user",
    predicate: "FOLLOW",
  },
  TRUST: {
    id: "TRUST",
    label: "I Trust",
    emoji: "🤝",
    description: "Influences reputation score (love and reach)",
    predicate: "TRUST",
  },
  KNOW_IRL: {
    id: "KNOW_IRL",
    label: "I Know IRL",
    emoji: "📍",
    description: "Opportunities for physical events and hackathons",
    predicate: "KNOW_IRL",
  },
  WORK_WITH: {
    id: "WORK_WITH",
    label: "I Work With",
    emoji: "💼",
    description: "Collaborate and code together",
    predicate: "WORK_WITH",
  },
  MET: {
    id: "MET",
    label: "I Met",
    emoji: "👋",
    description: "Having meetings and calls to discuss",
    predicate: "MET",
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
    atomData: "engineering",
  },
  design: {
    id: "design",
    label: "Design",
    category: "skill",
    atomData: "design",
  },
  product: {
    id: "product",
    label: "Product",
    category: "skill",
    atomData: "product",
  },
  marketing: {
    id: "marketing",
    label: "Marketing",
    category: "skill",
    atomData: "marketing",
  },
  community: {
    id: "community",
    label: "Community",
    category: "skill",
    atomData: "community",
  },
  research: {
    id: "research",
    label: "Research",
    category: "skill",
    atomData: "research",
  },
  writing: {
    id: "writing",
    label: "Writing",
    category: "skill",
    atomData: "writing",
  },
  dataScience: {
    id: "dataScience",
    label: "Data Science",
    category: "skill",
    atomData: "data_science",
  },
  security: {
    id: "security",
    label: "Security",
    category: "skill",
    atomData: "security",
  },
  devrel: {
    id: "devrel",
    label: "DevRel",
    category: "skill",
    atomData: "devrel",
  },
  projectManagement: {
    id: "projectManagement",
    label: "Project Management",
    category: "skill",
    atomData: "project_management",
  },
  smartContracts: {
    id: "smartContracts",
    label: "Smart Contracts",
    category: "skill",
    atomData: "smart_contracts",
  },
  trading: {
    id: "trading",
    label: "Trading",
    category: "skill",
    atomData: "trading",
  },
  governance: {
    id: "governance",
    label: "Governance",
    category: "skill",
    atomData: "governance",
  },
  tokenomics: {
    id: "tokenomics",
    label: "Tokenomics",
    category: "skill",
    atomData: "tokenomics",
  },
  defi: {
    id: "defi",
    label: "DeFi",
    category: "skill",
    atomData: "defi",
  },
  devops: {
    id: "devops",
    label: "DevOps",
    category: "skill",
    atomData: "devops",
  },
  contentCreation: {
    id: "contentCreation",
    label: "Content Creation",
    category: "skill",
    atomData: "content_creation",
  },
  analytics: {
    id: "analytics",
    label: "Analytics",
    category: "skill",
    atomData: "analytics",
  },
  ux: {
    id: "ux",
    label: "UX",
    category: "skill",
    atomData: "ux",
  },
  qa: {
    id: "qa",
    label: "QA",
    category: "skill",
    atomData: "qa",
  },
  bizdev: {
    id: "bizdev",
    label: "BizDev",
    category: "skill",
    atomData: "bizdev",
  },
  education: {
    id: "education",
    label: "Education",
    category: "skill",
    atomData: "education",
  },
  illustration: {
    id: "illustration",
    label: "Illustration",
    category: "skill",
    atomData: "illustration",
  },
  animation: {
    id: "animation",
    label: "Animation",
    category: "skill",
    atomData: "animation",
  },
  photography: {
    id: "photography",
    label: "Photography",
    category: "skill",
    atomData: "photography",
  },
  videography: {
    id: "videography",
    label: "Videography",
    category: "skill",
    atomData: "videography",
  },
  videoEditing: {
    id: "videoEditing",
    label: "Video Editing",
    category: "skill",
    atomData: "video_editing",
  },
  soundDesign: {
    id: "soundDesign",
    label: "Sound Design",
    category: "skill",
    atomData: "sound_design",
  },
  musicProduction: {
    id: "musicProduction",
    label: "Music Production",
    category: "skill",
    atomData: "music_production",
  },
  threeDModeling: {
    id: "threeDModeling",
    label: "3D Modeling",
    category: "skill",
    atomData: "3d_modeling",
  },
  copywriting: {
    id: "copywriting",
    label: "Copywriting",
    category: "skill",
    atomData: "copywriting",
  },
  socialMedia: {
    id: "socialMedia",
    label: "Social Media",
    category: "skill",
    atomData: "social_media",
  },
  streaming: {
    id: "streaming",
    label: "Streaming",
    category: "skill",
    atomData: "streaming",
  },
  podcasting: {
    id: "podcasting",
    label: "Podcasting",
    category: "skill",
    atomData: "podcasting",
  },
  storytelling: {
    id: "storytelling",
    label: "Storytelling",
    category: "skill",
    atomData: "storytelling",
  },
  nftStrategy: {
    id: "nftStrategy",
    label: "NFT Strategy",
    category: "skill",
    atomData: "nft_strategy",
  },
  curation: {
    id: "curation",
    label: "Curation",
    category: "skill",
    atomData: "curation",
  },
  moderation: {
    id: "moderation",
    label: "Moderation",
    category: "skill",
    atomData: "moderation",
  },
  eventPlanning: {
    id: "eventPlanning",
    label: "Event Planning",
    category: "skill",
    atomData: "event_planning",
  },
  fundraising: {
    id: "fundraising",
    label: "Fundraising",
    category: "skill",
    atomData: "fundraising",
  },
  hr: {
    id: "hr",
    label: "HR",
    category: "skill",
    atomData: "hr",
  },
  operations: {
    id: "operations",
    label: "Operations",
    category: "skill",
    atomData: "operations",
  },
  legal: {
    id: "legal",
    label: "Legal",
    category: "skill",
    atomData: "legal",
  },
  accounting: {
    id: "accounting",
    label: "Accounting",
    category: "skill",
    atomData: "accounting",
  },
  partnerships: {
    id: "partnerships",
    label: "Partnerships",
    category: "skill",
    atomData: "partnerships",
  },
  growth: {
    id: "growth",
    label: "Growth",
    category: "skill",
    atomData: "growth",
  },
  brandDesign: {
    id: "brandDesign",
    label: "Brand Design",
    category: "skill",
    atomData: "brand_design",
  },

  // Tools
  vscode: {
    id: "vscode",
    label: "VS Code",
    category: "tool",
    atomData: "vscode",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    category: "tool",
    atomData: "cursor",
  },
  claude: {
    id: "claude",
    label: "Claude",
    category: "tool",
    atomData: "claude",
  },
  notion: {
    id: "notion",
    label: "Notion",
    category: "tool",
    atomData: "notion",
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    category: "tool",
    atomData: "chatgpt",
  },
  figma: {
    id: "figma",
    label: "Figma",
    category: "tool",
    atomData: "figma",
  },
  github: {
    id: "github",
    label: "GitHub",
    category: "tool",
    atomData: "github",
  },
  davinci: {
    id: "davinci",
    label: "DaVinci Resolve",
    category: "tool",
    atomData: "davinci",
  },
  linear: {
    id: "linear",
    label: "Linear",
    category: "tool",
    atomData: "linear",
  },
  discord: {
    id: "discord",
    label: "Discord",
    category: "tool",
    atomData: "discord",
  },
  telegram: {
    id: "telegram",
    label: "Telegram",
    category: "tool",
    atomData: "telegram",
  },
  dune: {
    id: "dune",
    label: "Dune",
    category: "tool",
    atomData: "dune",
  },
  remix: {
    id: "remix",
    label: "Remix IDE",
    category: "tool",
    atomData: "remix",
  },
  hardhat: {
    id: "hardhat",
    label: "Hardhat",
    category: "tool",
    atomData: "hardhat",
  },
  foundry: {
    id: "foundry",
    label: "Foundry",
    category: "tool",
    atomData: "foundry",
  },
  vercel: {
    id: "vercel",
    label: "Vercel",
    category: "tool",
    atomData: "vercel",
  },
  arc: {
    id: "arc",
    label: "Arc",
    category: "tool",
    atomData: "arc",
  },
  obsidian: {
    id: "obsidian",
    label: "Obsidian",
    category: "tool",
    atomData: "obsidian",
  },
  blender: {
    id: "blender",
    label: "Blender",
    category: "tool",
    atomData: "blender",
  },
  photoshop: {
    id: "photoshop",
    label: "Photoshop",
    category: "tool",
    atomData: "photoshop",
  },
  canva: {
    id: "canva",
    label: "Canva",
    category: "tool",
    atomData: "canva",
  },
  slack: {
    id: "slack",
    label: "Slack",
    category: "tool",
    atomData: "slack",
  },
  miro: {
    id: "miro",
    label: "Miro",
    category: "tool",
    atomData: "miro",
  },
  windsurf: {
    id: "windsurf",
    label: "Windsurf",
    category: "tool",
    atomData: "windsurf",
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot",
    category: "tool",
    atomData: "copilot",
  },
  v0: {
    id: "v0",
    label: "v0",
    category: "tool",
    atomData: "v0",
  },
  bolt: {
    id: "bolt",
    label: "Bolt",
    category: "tool",
    atomData: "bolt",
  },
  replit: {
    id: "replit",
    label: "Replit",
    category: "tool",
    atomData: "replit",
  },
  railway: {
    id: "railway",
    label: "Railway",
    category: "tool",
    atomData: "railway",
  },
  supabase: {
    id: "supabase",
    label: "Supabase",
    category: "tool",
    atomData: "supabase",
  },
  firebase: {
    id: "firebase",
    label: "Firebase",
    category: "tool",
    atomData: "firebase",
  },
  docker: {
    id: "docker",
    label: "Docker",
    category: "tool",
    atomData: "docker",
  },
  terraform: {
    id: "terraform",
    label: "Terraform",
    category: "tool",
    atomData: "terraform",
  },
  etherscan: {
    id: "etherscan",
    label: "Etherscan",
    category: "tool",
    atomData: "etherscan",
  },
  safe: {
    id: "safe",
    label: "Safe",
    category: "tool",
    atomData: "safe",
  },
  metamask: {
    id: "metamask",
    label: "MetaMask",
    category: "tool",
    atomData: "metamask",
  },
  rainbow: {
    id: "rainbow",
    label: "Rainbow",
    category: "tool",
    atomData: "rainbow",
  },
  tenderly: {
    id: "tenderly",
    label: "Tenderly",
    category: "tool",
    atomData: "tenderly",
  },
  alchemy: {
    id: "alchemy",
    label: "Alchemy",
    category: "tool",
    atomData: "alchemy",
  },
  infura: {
    id: "infura",
    label: "Infura",
    category: "tool",
    atomData: "infura",
  },
  excalidraw: {
    id: "excalidraw",
    label: "Excalidraw",
    category: "tool",
    atomData: "excalidraw",
  },
  loom: {
    id: "loom",
    label: "Loom",
    category: "tool",
    atomData: "loom",
  },
  afterEffects: {
    id: "afterEffects",
    label: "After Effects",
    category: "tool",
    atomData: "after_effects",
  },
  premiere: {
    id: "premiere",
    label: "Premiere Pro",
    category: "tool",
    atomData: "premiere",
  },
  midjourney: {
    id: "midjourney",
    label: "Midjourney",
    category: "tool",
    atomData: "midjourney",
  },
  framer: {
    id: "framer",
    label: "Framer",
    category: "tool",
    atomData: "framer",
  },
  webstorm: {
    id: "webstorm",
    label: "WebStorm",
    category: "tool",
    atomData: "webstorm",
  },
  warp: {
    id: "warp",
    label: "Warp",
    category: "tool",
    atomData: "warp",
  },
  iterm: {
    id: "iterm",
    label: "iTerm2",
    category: "tool",
    atomData: "iterm",
  },
  postman: {
    id: "postman",
    label: "Postman",
    category: "tool",
    atomData: "postman",
  },
  procreate: {
    id: "procreate",
    label: "Procreate",
    category: "tool",
    atomData: "procreate",
  },
  illustrator: {
    id: "illustrator",
    label: "Illustrator",
    category: "tool",
    atomData: "illustrator",
  },
  cinema4d: {
    id: "cinema4d",
    label: "Cinema 4D",
    category: "tool",
    atomData: "cinema4d",
  },
  unrealEngine: {
    id: "unrealEngine",
    label: "Unreal Engine",
    category: "tool",
    atomData: "unreal_engine",
  },
  unity: {
    id: "unity",
    label: "Unity",
    category: "tool",
    atomData: "unity",
  },
  touchDesigner: {
    id: "touchDesigner",
    label: "TouchDesigner",
    category: "tool",
    atomData: "touch_designer",
  },
  ableton: {
    id: "ableton",
    label: "Ableton Live",
    category: "tool",
    atomData: "ableton",
  },
  logicPro: {
    id: "logicPro",
    label: "Logic Pro",
    category: "tool",
    atomData: "logic_pro",
  },
  obs: {
    id: "obs",
    label: "OBS",
    category: "tool",
    atomData: "obs",
  },
  streamyard: {
    id: "streamyard",
    label: "StreamYard",
    category: "tool",
    atomData: "streamyard",
  },
  riverside: {
    id: "riverside",
    label: "Riverside",
    category: "tool",
    atomData: "riverside",
  },
  descript: {
    id: "descript",
    label: "Descript",
    category: "tool",
    atomData: "descript",
  },
  capcut: {
    id: "capcut",
    label: "CapCut",
    category: "tool",
    atomData: "capcut",
  },
  finalCutPro: {
    id: "finalCutPro",
    label: "Final Cut Pro",
    category: "tool",
    atomData: "final_cut_pro",
  },
  opensea: {
    id: "opensea",
    label: "OpenSea",
    category: "tool",
    atomData: "opensea",
  },
  zora: {
    id: "zora",
    label: "Zora",
    category: "tool",
    atomData: "zora",
  },
  manifold: {
    id: "manifold",
    label: "Manifold",
    category: "tool",
    atomData: "manifold",
  },
  snapshot: {
    id: "snapshot",
    label: "Snapshot",
    category: "tool",
    atomData: "snapshot",
  },
  tally: {
    id: "tally",
    label: "Tally",
    category: "tool",
    atomData: "tally",
  },
  coordinape: {
    id: "coordinape",
    label: "Coordinape",
    category: "tool",
    atomData: "coordinape",
  },
  guild: {
    id: "guild",
    label: "Guild.xyz",
    category: "tool",
    atomData: "guild",
  },
  combot: {
    id: "combot",
    label: "Combot",
    category: "tool",
    atomData: "combot",
  },
  sproutSocial: {
    id: "sproutSocial",
    label: "Sprout Social",
    category: "tool",
    atomData: "sprout_social",
  },
  buffer: {
    id: "buffer",
    label: "Buffer",
    category: "tool",
    atomData: "buffer",
  },
  typefully: {
    id: "typefully",
    label: "Typefully",
    category: "tool",
    atomData: "typefully",
  },
  superfluid: {
    id: "superfluid",
    label: "Superfluid",
    category: "tool",
    atomData: "superfluid",
  },
  juicebox: {
    id: "juicebox",
    label: "Juicebox",
    category: "tool",
    atomData: "juicebox",
  },
  airtable: {
    id: "airtable",
    label: "Airtable",
    category: "tool",
    atomData: "airtable",
  },
  clickup: {
    id: "clickup",
    label: "ClickUp",
    category: "tool",
    atomData: "clickup",
  },
  asana: {
    id: "asana",
    label: "Asana",
    category: "tool",
    atomData: "asana",
  },
  whimsical: {
    id: "whimsical",
    label: "Whimsical",
    category: "tool",
    atomData: "whimsical",
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
 * Get the on-chain atom data string for an attribute.
 * This becomes the object atom in triples: [User] [has_attribute] [atomData]
 */
export function getAttributeAtomData(id: AttributeId): string {
  return ATTRIBUTES[id].atomData;
}

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
  governance: {
    id: "governance",
    label: "Governance",
    category: "skill",
    predicate: "atlas:attr:governance",
  },
  tokenomics: {
    id: "tokenomics",
    label: "Tokenomics",
    category: "skill",
    predicate: "atlas:attr:tokenomics",
  },
  defi: {
    id: "defi",
    label: "DeFi",
    category: "skill",
    predicate: "atlas:attr:defi",
  },
  devops: {
    id: "devops",
    label: "DevOps",
    category: "skill",
    predicate: "atlas:attr:devops",
  },
  contentCreation: {
    id: "contentCreation",
    label: "Content Creation",
    category: "skill",
    predicate: "atlas:attr:content_creation",
  },
  analytics: {
    id: "analytics",
    label: "Analytics",
    category: "skill",
    predicate: "atlas:attr:analytics",
  },
  ux: {
    id: "ux",
    label: "UX",
    category: "skill",
    predicate: "atlas:attr:ux",
  },
  qa: {
    id: "qa",
    label: "QA",
    category: "skill",
    predicate: "atlas:attr:qa",
  },
  bizdev: {
    id: "bizdev",
    label: "BizDev",
    category: "skill",
    predicate: "atlas:attr:bizdev",
  },
  education: {
    id: "education",
    label: "Education",
    category: "skill",
    predicate: "atlas:attr:education",
  },
  illustration: {
    id: "illustration",
    label: "Illustration",
    category: "skill",
    predicate: "atlas:attr:illustration",
  },
  animation: {
    id: "animation",
    label: "Animation",
    category: "skill",
    predicate: "atlas:attr:animation",
  },
  photography: {
    id: "photography",
    label: "Photography",
    category: "skill",
    predicate: "atlas:attr:photography",
  },
  videography: {
    id: "videography",
    label: "Videography",
    category: "skill",
    predicate: "atlas:attr:videography",
  },
  videoEditing: {
    id: "videoEditing",
    label: "Video Editing",
    category: "skill",
    predicate: "atlas:attr:video_editing",
  },
  soundDesign: {
    id: "soundDesign",
    label: "Sound Design",
    category: "skill",
    predicate: "atlas:attr:sound_design",
  },
  musicProduction: {
    id: "musicProduction",
    label: "Music Production",
    category: "skill",
    predicate: "atlas:attr:music_production",
  },
  threeDModeling: {
    id: "threeDModeling",
    label: "3D Modeling",
    category: "skill",
    predicate: "atlas:attr:3d_modeling",
  },
  copywriting: {
    id: "copywriting",
    label: "Copywriting",
    category: "skill",
    predicate: "atlas:attr:copywriting",
  },
  socialMedia: {
    id: "socialMedia",
    label: "Social Media",
    category: "skill",
    predicate: "atlas:attr:social_media",
  },
  streaming: {
    id: "streaming",
    label: "Streaming",
    category: "skill",
    predicate: "atlas:attr:streaming",
  },
  podcasting: {
    id: "podcasting",
    label: "Podcasting",
    category: "skill",
    predicate: "atlas:attr:podcasting",
  },
  storytelling: {
    id: "storytelling",
    label: "Storytelling",
    category: "skill",
    predicate: "atlas:attr:storytelling",
  },
  nftStrategy: {
    id: "nftStrategy",
    label: "NFT Strategy",
    category: "skill",
    predicate: "atlas:attr:nft_strategy",
  },
  curation: {
    id: "curation",
    label: "Curation",
    category: "skill",
    predicate: "atlas:attr:curation",
  },
  moderation: {
    id: "moderation",
    label: "Moderation",
    category: "skill",
    predicate: "atlas:attr:moderation",
  },
  eventPlanning: {
    id: "eventPlanning",
    label: "Event Planning",
    category: "skill",
    predicate: "atlas:attr:event_planning",
  },
  fundraising: {
    id: "fundraising",
    label: "Fundraising",
    category: "skill",
    predicate: "atlas:attr:fundraising",
  },
  hr: {
    id: "hr",
    label: "HR",
    category: "skill",
    predicate: "atlas:attr:hr",
  },
  operations: {
    id: "operations",
    label: "Operations",
    category: "skill",
    predicate: "atlas:attr:operations",
  },
  legal: {
    id: "legal",
    label: "Legal",
    category: "skill",
    predicate: "atlas:attr:legal",
  },
  accounting: {
    id: "accounting",
    label: "Accounting",
    category: "skill",
    predicate: "atlas:attr:accounting",
  },
  partnerships: {
    id: "partnerships",
    label: "Partnerships",
    category: "skill",
    predicate: "atlas:attr:partnerships",
  },
  growth: {
    id: "growth",
    label: "Growth",
    category: "skill",
    predicate: "atlas:attr:growth",
  },
  brandDesign: {
    id: "brandDesign",
    label: "Brand Design",
    category: "skill",
    predicate: "atlas:attr:brand_design",
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
  windsurf: {
    id: "windsurf",
    label: "Windsurf",
    category: "tool",
    predicate: "atlas:attr:windsurf",
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot",
    category: "tool",
    predicate: "atlas:attr:copilot",
  },
  v0: {
    id: "v0",
    label: "v0",
    category: "tool",
    predicate: "atlas:attr:v0",
  },
  bolt: {
    id: "bolt",
    label: "Bolt",
    category: "tool",
    predicate: "atlas:attr:bolt",
  },
  replit: {
    id: "replit",
    label: "Replit",
    category: "tool",
    predicate: "atlas:attr:replit",
  },
  railway: {
    id: "railway",
    label: "Railway",
    category: "tool",
    predicate: "atlas:attr:railway",
  },
  supabase: {
    id: "supabase",
    label: "Supabase",
    category: "tool",
    predicate: "atlas:attr:supabase",
  },
  firebase: {
    id: "firebase",
    label: "Firebase",
    category: "tool",
    predicate: "atlas:attr:firebase",
  },
  docker: {
    id: "docker",
    label: "Docker",
    category: "tool",
    predicate: "atlas:attr:docker",
  },
  terraform: {
    id: "terraform",
    label: "Terraform",
    category: "tool",
    predicate: "atlas:attr:terraform",
  },
  etherscan: {
    id: "etherscan",
    label: "Etherscan",
    category: "tool",
    predicate: "atlas:attr:etherscan",
  },
  safe: {
    id: "safe",
    label: "Safe",
    category: "tool",
    predicate: "atlas:attr:safe",
  },
  metamask: {
    id: "metamask",
    label: "MetaMask",
    category: "tool",
    predicate: "atlas:attr:metamask",
  },
  rainbow: {
    id: "rainbow",
    label: "Rainbow",
    category: "tool",
    predicate: "atlas:attr:rainbow",
  },
  tenderly: {
    id: "tenderly",
    label: "Tenderly",
    category: "tool",
    predicate: "atlas:attr:tenderly",
  },
  alchemy: {
    id: "alchemy",
    label: "Alchemy",
    category: "tool",
    predicate: "atlas:attr:alchemy",
  },
  infura: {
    id: "infura",
    label: "Infura",
    category: "tool",
    predicate: "atlas:attr:infura",
  },
  excalidraw: {
    id: "excalidraw",
    label: "Excalidraw",
    category: "tool",
    predicate: "atlas:attr:excalidraw",
  },
  loom: {
    id: "loom",
    label: "Loom",
    category: "tool",
    predicate: "atlas:attr:loom",
  },
  afterEffects: {
    id: "afterEffects",
    label: "After Effects",
    category: "tool",
    predicate: "atlas:attr:after_effects",
  },
  premiere: {
    id: "premiere",
    label: "Premiere Pro",
    category: "tool",
    predicate: "atlas:attr:premiere",
  },
  midjourney: {
    id: "midjourney",
    label: "Midjourney",
    category: "tool",
    predicate: "atlas:attr:midjourney",
  },
  framer: {
    id: "framer",
    label: "Framer",
    category: "tool",
    predicate: "atlas:attr:framer",
  },
  webstorm: {
    id: "webstorm",
    label: "WebStorm",
    category: "tool",
    predicate: "atlas:attr:webstorm",
  },
  warp: {
    id: "warp",
    label: "Warp",
    category: "tool",
    predicate: "atlas:attr:warp",
  },
  iterm: {
    id: "iterm",
    label: "iTerm2",
    category: "tool",
    predicate: "atlas:attr:iterm",
  },
  postman: {
    id: "postman",
    label: "Postman",
    category: "tool",
    predicate: "atlas:attr:postman",
  },
  procreate: {
    id: "procreate",
    label: "Procreate",
    category: "tool",
    predicate: "atlas:attr:procreate",
  },
  illustrator: {
    id: "illustrator",
    label: "Illustrator",
    category: "tool",
    predicate: "atlas:attr:illustrator",
  },
  cinema4d: {
    id: "cinema4d",
    label: "Cinema 4D",
    category: "tool",
    predicate: "atlas:attr:cinema4d",
  },
  unrealEngine: {
    id: "unrealEngine",
    label: "Unreal Engine",
    category: "tool",
    predicate: "atlas:attr:unreal_engine",
  },
  unity: {
    id: "unity",
    label: "Unity",
    category: "tool",
    predicate: "atlas:attr:unity",
  },
  touchDesigner: {
    id: "touchDesigner",
    label: "TouchDesigner",
    category: "tool",
    predicate: "atlas:attr:touch_designer",
  },
  ableton: {
    id: "ableton",
    label: "Ableton Live",
    category: "tool",
    predicate: "atlas:attr:ableton",
  },
  logicPro: {
    id: "logicPro",
    label: "Logic Pro",
    category: "tool",
    predicate: "atlas:attr:logic_pro",
  },
  obs: {
    id: "obs",
    label: "OBS",
    category: "tool",
    predicate: "atlas:attr:obs",
  },
  streamyard: {
    id: "streamyard",
    label: "StreamYard",
    category: "tool",
    predicate: "atlas:attr:streamyard",
  },
  riverside: {
    id: "riverside",
    label: "Riverside",
    category: "tool",
    predicate: "atlas:attr:riverside",
  },
  descript: {
    id: "descript",
    label: "Descript",
    category: "tool",
    predicate: "atlas:attr:descript",
  },
  capcut: {
    id: "capcut",
    label: "CapCut",
    category: "tool",
    predicate: "atlas:attr:capcut",
  },
  finalCutPro: {
    id: "finalCutPro",
    label: "Final Cut Pro",
    category: "tool",
    predicate: "atlas:attr:final_cut_pro",
  },
  opensea: {
    id: "opensea",
    label: "OpenSea",
    category: "tool",
    predicate: "atlas:attr:opensea",
  },
  zora: {
    id: "zora",
    label: "Zora",
    category: "tool",
    predicate: "atlas:attr:zora",
  },
  manifold: {
    id: "manifold",
    label: "Manifold",
    category: "tool",
    predicate: "atlas:attr:manifold",
  },
  snapshot: {
    id: "snapshot",
    label: "Snapshot",
    category: "tool",
    predicate: "atlas:attr:snapshot",
  },
  tally: {
    id: "tally",
    label: "Tally",
    category: "tool",
    predicate: "atlas:attr:tally",
  },
  coordinape: {
    id: "coordinape",
    label: "Coordinape",
    category: "tool",
    predicate: "atlas:attr:coordinape",
  },
  guild: {
    id: "guild",
    label: "Guild.xyz",
    category: "tool",
    predicate: "atlas:attr:guild",
  },
  combot: {
    id: "combot",
    label: "Combot",
    category: "tool",
    predicate: "atlas:attr:combot",
  },
  sproutSocial: {
    id: "sproutSocial",
    label: "Sprout Social",
    category: "tool",
    predicate: "atlas:attr:sprout_social",
  },
  buffer: {
    id: "buffer",
    label: "Buffer",
    category: "tool",
    predicate: "atlas:attr:buffer",
  },
  typefully: {
    id: "typefully",
    label: "Typefully",
    category: "tool",
    predicate: "atlas:attr:typefully",
  },
  superfluid: {
    id: "superfluid",
    label: "Superfluid",
    category: "tool",
    predicate: "atlas:attr:superfluid",
  },
  juicebox: {
    id: "juicebox",
    label: "Juicebox",
    category: "tool",
    predicate: "atlas:attr:juicebox",
  },
  airtable: {
    id: "airtable",
    label: "Airtable",
    category: "tool",
    predicate: "atlas:attr:airtable",
  },
  clickup: {
    id: "clickup",
    label: "ClickUp",
    category: "tool",
    predicate: "atlas:attr:clickup",
  },
  asana: {
    id: "asana",
    label: "Asana",
    category: "tool",
    predicate: "atlas:attr:asana",
  },
  whimsical: {
    id: "whimsical",
    label: "Whimsical",
    category: "tool",
    predicate: "atlas:attr:whimsical",
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

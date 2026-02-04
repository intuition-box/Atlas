/**
 * Attestation Types Configuration
 *
 * Attestations are global user-to-user signals.
 * They are not scoped to communities.
 */

export const ATTESTATION_TYPES = {
  FOLLOW: {
    id: "FOLLOW",
    label: "I Follow",
    description: "Get notifications and updates about this user",
  },
  TRUST: {
    id: "TRUST",
    label: "I Trust",
    description: "Influences reputation score (love and reach)",
  },
  KNOW_IRL: {
    id: "KNOW_IRL",
    label: "I Know IRL",
    description: "Opportunities for physical events and hackathons",
  },
  WORK_WITH: {
    id: "WORK_WITH",
    label: "I Work With",
    description: "Collaborate and code together",
  },
  MET: {
    id: "MET",
    label: "I Met",
    description: "Having meetings and calls to discuss",
  },
} as const;

export type AttestationType = keyof typeof ATTESTATION_TYPES;

export const ATTESTATION_TYPE_LIST = Object.values(ATTESTATION_TYPES);

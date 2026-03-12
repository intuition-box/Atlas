/**
 * Tour Definitions
 *
 * Pure data — no React imports. Each tour is a factory function that
 * accepts the viewer's handle and returns a TourDefinition.
 *
 * Tours are contextual and triggered when the user reaches a relevant
 * part of the app for the first time.
 */

import { ROUTES, communityOrbitPath, communityPath, userAttestationsPath, userPath, userSettingsPath } from "@/lib/routes";

/* ────────────────────────────
   Constants
──────────────────────────── */

/** Demo profile handles for the First Endorsement tour (ordered by completeness, skipping self). */
const ENDORSEMENT_DEMO_HANDLES = ["saulo", "mkultra"];

/** Demo community handle for the Joining a Community tour. */
const COMMUNITY_DEMO_HANDLE = "intuition";

/* ────────────────────────────
   Types
──────────────────────────── */

export type TourStep = {
  /** CSS selector for the target element, e.g. '[data-tour="nav-menu"]' */
  target: string;
  /** Fallback CSS selector if `target` is not found (e.g. empty list → highlight the card). */
  fallbackTarget?: string;
  /** If set, navigate to this route before showing the step */
  route?: string;
  /** Step title shown in the popover */
  title: string;
  /** Step description shown in the popover */
  description: string;
  /** Popover placement relative to target */
  side: "top" | "bottom" | "left" | "right";
  /** Cross-axis alignment — defaults to "center" (centered on the highlight) */
  align?: "start" | "center" | "end";
  /** Pin the popover to a viewport corner (overrides side/align). Useful for full-page targets. */
  popoverPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
};

export type TourDefinition = {
  /** Unique ID used for localStorage persistence */
  id: string;
  /** Ordered list of steps */
  steps: TourStep[];
};

/* ────────────────────────────
   Tour IDs (stable constants)
──────────────────────────── */

export const TOUR_IDS = {
  WELCOME: "welcome",
  PROFILE_SETUP: "profile-setup",
  FIRST_ENDORSEMENT: "first-endorsement",
  PUBLISHING: "publishing",
  JOINING_COMMUNITY: "joining-community",
} as const;

/* ────────────────────────────
   Tour Factories
──────────────────────────── */

/**
 * Welcome to Atlas — triggered after first onboarding.
 * Highlights the Intuition community, navigation, and top-right controls.
 * For logged-out users, also shows the sign-in page step.
 */
export function createWelcomeTour(isAuthed: boolean): TourDefinition {
  const steps: TourStep[] = [
    {
      target: '[data-tour="community-intuition"]',
      route: ROUTES.home,
      title: "Welcome to Atlas",
      description:
        "This is the Atlas Universe, each node is a community. This is Intuition — you can enter it to explore its members, activity, and orbit.",
      side: "bottom",
      align: "center",
    },
    {
      target: '[data-tour="nav-menu"]',
      route: ROUTES.home,
      title: "Navigation",
      description:
        "Access everything from here — communities, activity, your profile, and attestations.",
      side: "bottom",
      align: "start",
    },
    {
      target: '[data-tour="top-right-controls"]',
      route: ROUTES.home,
      title: "Quick Actions",
      description:
        "Your attestation cart with endorsments, guided tours, sound controls, and visibility toggle — all in one place.",
      side: "bottom",
      align: "end",
    },
  ];

  // Only show the sign-in step to logged-out users
  if (!isAuthed) {
    steps.push({
      target: '[data-tour="signin-card"]',
      route: ROUTES.signIn,
      title: "Join Atlas",
      description:
        "Sign in to create your profile, join communities, and start building your reputation.",
      side: "right",
      align: "center",
    });
  }

  return {
    id: TOUR_IDS.WELCOME,
    steps,
  };
}

/**
 * Set Up Your Profile — triggered on first visit to own settings page.
 * Walks through the key profile sections: socials, wallet, identity, and skills.
 */
export function createProfileSetupTour(handle: string): TourDefinition {
  const settingsRoute = userSettingsPath(handle);

  return {
    id: TOUR_IDS.PROFILE_SETUP,
    steps: [
      {
        target: '[data-tour="settings-socials"]',
        route: settingsRoute,
        title: "Link Your Accounts",
        description:
          "Connect other platforms to build your Atlas identity. Linked accounts strengthen your reputation and give you more ways to sign in.",
        side: "bottom",
        align: "center",
      },
      {
        target: '[data-tour="settings-wallets"]',
        route: settingsRoute,
        title: "Connect a Wallet",
        description:
          "Link your wallet to enable onchain features. This is how attestations become permanent and verifiable, without a wallet you cannot receive onchain endorsements.",
        side: "bottom",
        align: "center",

      },
      {
        target: '[data-tour="settings-profile-fields"]',
        route: settingsRoute,
        title: "Your Identity",
        description:
          "Set your name, handle, and other personal information — this is how others will recognize you across Atlas.",
        side: "bottom",
        align: "center",
      },
      {
        target: '[data-tour="settings-skills-tools"]',
        route: settingsRoute,
        title: "Showcase Your Expertise",
        description:
          "Add skills and tools to your profile. This makes you discoverable and lets others endorse you for what you're great at.",
        side: "top",
        align: "center",

      },
    ],
  };
}

/**
 * First Endorsement — navigates to a demo profile so users can
 * explore another user's profile and understand the endorsement flow.
 *
 * Rotates between demo handles, skipping the viewer's own profile.
 */
export function createFirstEndorsementTour(viewerHandle: string | null): TourDefinition {
  const candidates = ENDORSEMENT_DEMO_HANDLES.filter((h) => h !== viewerHandle);
  const demoHandle = candidates[0] ?? ENDORSEMENT_DEMO_HANDLES[0]!;
  const demoProfile = userPath(demoHandle);

  return {
    id: TOUR_IDS.FIRST_ENDORSEMENT,
    steps: [
      {
        target: '[data-tour="profile-nav"]',
        route: demoProfile,
        title: "Explore Their Profile",
        description:
          "Use these tabs to check their activity, attestations, and profile details. It's a good way to learn about someone before endorsing them.",
        side: "bottom",
        align: "center",

      },
      {
        target: '[data-tour="socials-card"]',
        route: demoProfile,
        title: "Verify Their Identity",
        description:
          "Check their linked accounts — Discord, X, GitHub, and wallets. This helps confirm they are who they say they are before you endorse.",
        side: "bottom",
        align: "center",

      },
      {
        target: '[data-tour="skills-tools-section"]',
        route: demoProfile,
        title: "Skills & Tools",
        description:
          "Skills and tools show what someone is great at and what they work with. Click any badge to endorse — each endorsement becomes a verifiable onchain attestation that strengthens their reputation.",
        side: "top",
        align: "center",
      },
      {
        target: '[data-tour="network-card"]',
        route: demoProfile,
        title: "Your Network",
        description:
          "Define how you know this person. Each button is a toggle — click once to endorse, click again to remove it. These attestations map your professional network onchain.",
        side: "top",
        align: "center",
      },
    ],
  };
}

/**
 * Publishing Attestations — triggered on first visit to own attestations page.
 * Explains the pending → published workflow, the attestation cart, and wallet linking.
 */
export function createPublishingTour(handle: string): TourDefinition {
  const attestationsRoute = userAttestationsPath(handle);
  const settingsRoute = userSettingsPath(handle);

  return {
    id: TOUR_IDS.PUBLISHING,
    steps: [
      {
        target: '[data-tour="onchain-banner"]',
        route: attestationsRoute,
        title: "Your Dashboard",
        description:
          "See how many attestations are pending and published. Batch-publish everything at once.",
        side: "bottom",
        align: "center",
      },
      {
        target: '[data-tour="attestation-row"]',
        fallbackTarget: '[data-tour="attestations-card"]',
        route: attestationsRoute,
        title: "Pending vs Published",
        description:
          "Pending means saved but not onchain yet. Published means it's permanent and verifiable onchain.",
        side: "bottom",
        align: "start",
      },
      {
        target: '[data-tour="publish-button"]',
        route: attestationsRoute,
        title: "Publish All",
        description:
          "Mint all pending attestations in one transaction. You'll need a connected wallet and a tiny bit of TRUST on the Intuition network.",
        side: "left",
        align: "center",
      },
      {
        target: '[data-tour="top-right-controls"]',
        route: attestationsRoute,
        title: "Attestation Cart",
        description:
          "The attestations cart only holds your pending attestations — endorsements you've made but haven't minted onchain yet. Once published, they move to the attestations page as permanent, verifiable records.",
        side: "bottom",
        align: "end",
      },
      {
        target: '[data-tour="settings-wallets"]',
        route: settingsRoute,
        title: "Connect a Wallet",
        description:
          "Link your wallet to enable onchain features. Without a wallet you cannot publish attestations or receive onchain endorsements.",
        side: "bottom",
        align: "center",
      },
    ],
  };
}

/**
 * Joining a Community — triggered on first visit to a community as non-member.
 * Uses the Intuition community as a hardcoded example.
 */
export function createJoiningCommunityTour(): TourDefinition {
  const demoCommunity = communityPath(COMMUNITY_DEMO_HANDLE);
  const demoCommunityOrbit = communityOrbitPath(COMMUNITY_DEMO_HANDLE);

  return {
    id: TOUR_IDS.JOINING_COMMUNITY,
    steps: [
      {
        target: '[data-tour="community-nav"]',
        route: demoCommunity,
        title: "Explore the Community",
        description:
          "Use these tabs to browse the community's orbit, profile, members, and activity. All these pages will give you insightful details about the community and its members.",
        side: "bottom",
        align: "center",
      },
      {
        target: '[data-tour="join-banner"]',
        route: demoCommunity,
        title: "Join the Community",
        description:
          "Apply to join — the community admins will review your request. Some communities are public, others are private. Some are open and others closed, once approved in closed communities you'll appear in the orbit and can start endorsing members.",
        side: "bottom",
        align: "center",
      },
      {
        target: '[data-tour="community-socials"]',
        route: demoCommunity,
        title: "Stay Connected",
        description:
          "Follow Intuition on their social channels — Discord, X, GitHub, and more. This is how you stay up to date with announcements, events, and how to increase your chances of getting more reputation.",
        side: "bottom",
        align: "center",
      },
      {
        target: '[data-tour="orbit-rings"]',
        route: demoCommunityOrbit,
        title: "The Orbit",
        description:
          "Each ring represents a role — Explorer, Participant, Contributor, and Advocate — moving closer to the center as engagement grows.\n\nMembers are scored by Love (endorsements received), Reach (connections made), and Gravity (overall influence in the community).",
        side: "bottom",
        align: "start",
        popoverPosition: "top-left",
      },
    ],
  };
}

"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet } from "@/lib/api/client";
import { parseApiError } from "@/lib/api/errors";
import { normalizeHandle, validateHandle } from "@/lib/handle";

import { Scroll, Users, UserPlus, FileText, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";

import { OrbitView } from "@/components/orbit/orbit-view";
import type { OrbitMember, MemberLink } from "@/components/orbit/types";
import { useNavigation, type NavigationControls } from "@/components/navigation/navigation-provider";

/* ────────────────────────────
   Types
──────────────────────────── */

type CommunityGetResponse = {
  mode: "full" | "splash";
  community: {
    id: string;
    handle: string | null;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    isMembershipOpen: boolean;
    membershipConfig: unknown | null;
    orbitConfig: unknown | null;
  };
  canViewDirectory: boolean;
  isAdmin: boolean;
  viewerMembership: {
    status: string;
    role: string;
  } | null;
  orbitMembers: unknown[];
  memberLinks?: unknown[]; // connections between members
};

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ready"; data: CommunityGetResponse };

/* ────────────────────────────
   Helpers
──────────────────────────── */

function parseMembers(raw: unknown[]): OrbitMember[] {
  const result: OrbitMember[] = [];

  for (const m of raw as any[]) {
    const id = String(m?.id ?? "");
    const name = String(m?.name ?? "");
    const handleOrId = String(m?.handle ?? id);
    const orbitLevel = m?.orbitLevel as OrbitMember["orbitLevel"];
    const reachScore = Number(m?.reachScore ?? 0);

    // Validate orbit level
    const validLevels = ["ADVOCATE", "CONTRIBUTOR", "PARTICIPANT", "EXPLORER"];
    if (!validLevels.includes(orbitLevel)) continue;
    if (!handleOrId || !name) continue;

    result.push({
      id: handleOrId,
      name: name || handleOrId,
      avatarUrl: (m?.avatarUrl ?? m?.image ?? null) as string | null,
      orbitLevel,
      reachScore,
      headline: (m?.headline ?? null) as string | null,
      tags: Array.isArray(m?.tags) ? m.tags : [],
      lastActiveAt: (m?.lastActiveAt ?? null) as string | null,
    });
  }

  return result;
}

function parseLinks(raw: unknown[] | undefined): MemberLink[] {
  if (!raw || !Array.isArray(raw)) return [];

  const result: MemberLink[] = [];

  for (const l of raw as any[]) {
    const source = String(l?.source ?? "");
    const target = String(l?.target ?? "");
    const weight = Number(l?.weight ?? 1);

    if (!source || !target) continue;

    result.push({ source, target, weight });
  }

  return result;
}

/* ────────────────────────────
   Component
──────────────────────────── */

export default function CommunityPage() {
  const params = useParams<{ handle: string }>();
  const router = useRouter();
  const rawHandle = String(params?.handle ?? "");
  const handle = React.useMemo(() => normalizeHandle(rawHandle), [rawHandle]);

  const [state, setState] = React.useState<LoadState>({ status: "idle" });

  React.useEffect(() => {
    const parsed = validateHandle(handle);
    if (!parsed.ok) {
      setState({ status: "not-found" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    void (async () => {
      const result = await apiGet<CommunityGetResponse>(
        "/api/community/get",
        { handle },
        { signal: controller.signal }
      );

      if (controller.signal.aborted) return;

      if (result.ok) {
        setState({ status: "ready", data: result.value });
        return;
      }

      if (result.error && typeof result.error === "object" && "status" in result.error) {
        const parsedErr = parseApiError(result.error);
        if (parsedErr.status === 404) {
          setState({ status: "not-found" });
          return;
        }
        setState({ status: "error", message: parsedErr.formError || "Something went wrong." });
        return;
      }

      const parsedErr = parseApiError(result.error);
      setState({ status: "error", message: parsedErr.formError || "Something went wrong." });
    })();

    return () => controller.abort();
  }, [handle]);

  /* ────────────────────────────
     Loading State
  ──────────────────────────── */

  if (state.status === "loading" || state.status === "idle") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="flex items-start gap-4">
          <div className="size-14 animate-pulse rounded-2xl bg-muted" />
          <div className="flex-1">
            <div className="h-6 w-64 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-4 w-96 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="mt-8 h-[560px] w-full animate-pulse rounded-2xl bg-muted" />
      </main>
    );
  }

  /* ────────────────────────────
     Not Found State
  ──────────────────────────── */

  if (state.status === "not-found") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <h1 className="text-lg font-semibold">Community not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">We couldn't find c/{handle}.</p>
      </main>
    );
  }

  /* ────────────────────────────
     Error State
  ──────────────────────────── */

  if (state.status === "error") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <h1 className="text-lg font-semibold">Couldn't load community</h1>
        <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => setState({ status: "idle" })}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  /* ────────────────────────────
     Ready State
  ──────────────────────────── */

  const { community } = state.data;
  const communityHandle = community.handle ?? handle;

  const members = parseMembers(state.data.orbitMembers ?? []);
  const links = parseLinks(state.data.memberLinks);

  return (
    <CommunityReadyState
      community={community}
      communityHandle={communityHandle}
      members={members}
      links={links}
      canViewDirectory={state.data.canViewDirectory}
      isAdmin={state.data.isAdmin}
      mode={state.data.mode}
      isMembershipOpen={community.isMembershipOpen}
      router={router}
    />
  );
}

/* ────────────────────────────
   Ready State Component
   (Separate component to use hooks)
──────────────────────────── */

type CommunityReadyStateProps = {
  community: CommunityGetResponse["community"];
  communityHandle: string;
  members: OrbitMember[];
  links: MemberLink[];
  canViewDirectory: boolean;
  isAdmin: boolean;
  mode: "full" | "splash";
  isMembershipOpen: boolean;
  router: ReturnType<typeof useRouter>;
};

function CommunityReadyState({
  community,
  communityHandle,
  members,
  links,
  canViewDirectory,
  isAdmin,
  mode,
  isMembershipOpen,
  router,
}: CommunityReadyStateProps) {
  // Build navigation controls based on context
  const navigationControls = React.useMemo<NavigationControls>(() => {
    const bottomLeft = [
      { icon: Scroll, label: "Attestations", href: `/c/${communityHandle}/attestations` },
      { icon: Users, label: "Members", href: `/c/${communityHandle}/members` },
      { icon: UserPlus, label: "Apply", href: `/c/${communityHandle}/apply` },
    ];

    const bottomRight = isAdmin
      ? [
          { icon: FileText, label: "Applications", href: `/c/${communityHandle}/applications` },
          { icon: Settings, label: "Settings", href: `/c/${communityHandle}/settings` },
        ]
      : [];

    return { bottomLeft, bottomRight };
  }, [communityHandle, isAdmin]);

  // Register navigation controls
  useNavigation(navigationControls);

  if (canViewDirectory) {
    return (
      <OrbitView
        members={members}
        links={links}
        centerLogoUrl={community.avatarUrl}
        centerName={community.name}
      />
    );
  }

  if (mode === "splash") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-border p-6">
          <h2 className="text-base font-semibold">Members-only</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This community is private. Apply to join to view the directory.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {isMembershipOpen && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push(`/c/${communityHandle}/apply`)}
              >
                Apply to join
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Back
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return null;
}

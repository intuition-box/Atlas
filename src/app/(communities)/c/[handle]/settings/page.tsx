import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/database";
import {
  HANDLE_POLICY,
  getActiveHandleForOwner,
  normalizeHandleKey,
  resolveCommunityIdFromHandle,
} from "@/lib/handle";

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export default async function CommunitySettingsPage(
  props: { params: Promise<{ handle: string }> }
) {
  const { handle: raw } = await props.params;
  const handleKey = normalizeHandleKey(raw);

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/api/auth/signin");

  const communityId = await resolveCommunityIdFromHandle(handleKey);
  if (!communityId) return notFound();

  const community = await db.community.findUnique({
    where: { id: communityId },
    select: {
      id: true,
      name: true,
      description: true,
      isPublicDirectory: true,
      ownerId: true,
      createdAt: true,
    },
  });

  if (!community) return notFound();
  if (community.ownerId !== userId) return notFound();

  const activeHandle = await getActiveHandleForOwner({
    ownerType: "COMMUNITY",
    ownerId: community.id,
  });
  const canonicalHandle = activeHandle ?? handleKey;

  async function saveSettings(formData: FormData) {
    "use server";

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) redirect("/api/auth/signin");

    const communityId = String(formData.get("communityId") ?? "").trim();
    if (!communityId) return notFound();

    const community = await db.community.findUnique({
      where: { id: communityId },
      select: { id: true, ownerId: true },
    });
    if (!community || community.ownerId !== userId) return notFound();

    const canonicalHandle = normalizeHandleKey(String(formData.get("canonicalHandle") ?? ""));
    if (!canonicalHandle) return notFound();

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const isPublicDirectory = formData.get("isPublicDirectory") === "on";

    if (name.length < 2) redirect(`/c/${canonicalHandle}/settings?error=name`);

    await db.community.update({
      where: { id: community.id },
      data: {
        name,
        description: description || null,
        isPublicDirectory,
      },
      select: { id: true },
    });

    redirect(`/c/${canonicalHandle}/settings?saved=1`);
  }

  async function changeHandle(formData: FormData) {
    "use server";

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) redirect("/api/auth/signin");

    const communityId = String(formData.get("communityId") ?? "").trim();
    if (!communityId) return notFound();

    const currentHandle = normalizeHandleKey(String(formData.get("currentHandle") ?? ""));

    const community = await db.community.findUnique({
      where: { id: communityId },
      select: { id: true, ownerId: true },
    });
    if (!community || community.ownerId !== userId) return notFound();

    const nextRaw = String(formData.get("nextHandle") ?? "");
    const nextHandle = normalizeHandleKey(nextRaw);

    if (!nextHandle) redirect(`/c/${currentHandle}/settings?error=handle`);
    if (nextHandle.length < 3 || nextHandle.length > 24) {
      redirect(`/c/${currentHandle}/settings?error=handle_length`);
    }

    // Simple charset rule for MVP: letters, numbers, underscores, hyphens.
    if (!/^[a-z0-9_-]+$/.test(nextHandle)) {
      redirect(`/c/${currentHandle}/settings?error=handle_chars`);
    }

    if (nextHandle === currentHandle) {
      redirect(`/c/${currentHandle}/settings?error=handle_same`);
    }

    const now = new Date();

    try {
      await db.$transaction(async (tx) => {
        // Find the current ACTIVE handle row for this community.
        const current = await tx.handle.findFirst({
          where: { status: "ACTIVE", ownerType: "COMMUNITY", ownerId: community.id },
          select: { id: true, handle: true },
        });

        if (!current || current.handle !== currentHandle) {
          // The route should only resolve for the active handle; if it doesn't match,
          // treat as not found to avoid weird edge-cases.
          throw new Error("HANDLE_MISMATCH");
        }

        // Validate the target handle row (if it exists).
        const existing = await tx.handle.findUnique({
          where: { handle: nextHandle },
          select: {
            id: true,
            status: true,
            ownerType: true,
            ownerId: true,
            lastOwnerType: true,
            lastOwnerId: true,
            reclaimUntil: true,
            availableAt: true,
          },
        });

        if (existing) {
          if (existing.status === "ACTIVE") throw new Error("HANDLE_TAKEN");
          if (existing.status === "RETIRED") throw new Error("HANDLE_RETIRED");

          // RELEASED: enforce reclaim/public availability windows.
          const canReclaim =
            existing.lastOwnerType === "COMMUNITY" &&
            existing.lastOwnerId === community.id &&
            existing.reclaimUntil &&
            now <= existing.reclaimUntil;

          const isPubliclyAvailable = existing.availableAt ? now >= existing.availableAt : true;

          if (!canReclaim && !isPubliclyAvailable) {
            throw new Error("HANDLE_NOT_AVAILABLE");
          }
        }

        // Release current handle: routes should 404 immediately, no redirect.
        await tx.handle.update({
          where: { id: current.id },
          data: {
            status: "RELEASED",
            ownerType: null,
            ownerId: null,
            lastOwnerType: "COMMUNITY",
            lastOwnerId: community.id,
            releasedAt: now,
            reclaimUntil: addDays(now, HANDLE_POLICY.reclaimWindowDays),
            availableAt: addDays(now, HANDLE_POLICY.publicReuseAfterDays),
          },
          select: { id: true },
        });

        // Claim the new handle.
        if (existing) {
          await tx.handle.update({
            where: { id: existing.id },
            data: {
              status: "ACTIVE",
              ownerType: "COMMUNITY",
              ownerId: community.id,
              claimedAt: now,
              releasedAt: null,
              reclaimUntil: null,
              availableAt: null,
            },
            select: { id: true },
          });
        } else {
          await tx.handle.create({
            data: {
              handle: nextHandle,
              status: "ACTIVE",
              ownerType: "COMMUNITY",
              ownerId: community.id,
              claimedAt: now,
            },
            select: { id: true },
          });
        }
      });
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "UNKNOWN";
      if (msg === "HANDLE_TAKEN") redirect(`/c/${currentHandle}/settings?error=handle_taken`);
      if (msg === "HANDLE_RETIRED") redirect(`/c/${currentHandle}/settings?error=handle_retired`);
      if (msg === "HANDLE_NOT_AVAILABLE") redirect(`/c/${currentHandle}/settings?error=handle_not_available`);
      if (msg === "HANDLE_MISMATCH") redirect(`/c/${currentHandle}/settings?error=handle_mismatch`);
      redirect(`/c/${currentHandle}/settings?error=unknown`);
    }

    redirect(`/c/${nextHandle}/settings?handle_changed=1`);
  }

  async function deleteCommunity(formData: FormData) {
    "use server";

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) redirect("/api/auth/signin");

    const communityId = String(formData.get("communityId") ?? "").trim();
    const currentHandle = normalizeHandleKey(String(formData.get("currentHandle") ?? ""));
    const confirm = String(formData.get("confirm") ?? "").trim();

    if (confirm !== "DELETE") {
      redirect(`/c/${currentHandle}/settings?error=confirm`);
    }

    if (!communityId) return notFound();

    const community = await db.community.findUnique({
      where: { id: communityId },
      select: { id: true, ownerId: true },
    });

    if (!community || community.ownerId !== userId) return notFound();

    const now = new Date();

    await db.$transaction(async (tx) => {
      // Retire the active handle permanently.
      const active = await tx.handle.findFirst({
        where: { status: "ACTIVE", ownerType: "COMMUNITY", ownerId: community.id },
        select: { id: true, handle: true },
      });

      if (active) {
        await tx.handle.update({
          where: { id: active.id },
          data: {
            status: "RETIRED",
            ownerType: null,
            ownerId: null,
            lastOwnerType: "COMMUNITY",
            lastOwnerId: community.id,
            retiredAt: now,
            releasedAt: now,
            reclaimUntil: null,
            availableAt: null,
          },
          select: { id: true },
        });
      }

      // Hard delete the community row.
      await tx.community.delete({
        where: { id: community.id },
        select: { id: true },
      });
    });

    redirect("/?deleted=1");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Community settings</h1>
        <p className="text-sm opacity-70">{community.name}</p>
        <p className="text-sm opacity-60">@{canonicalHandle}</p>
      </div>

      <div className="mt-8 grid gap-6">
        <section className="rounded-xl border p-4">
          <div className="text-sm font-medium">Profile</div>
          <p className="mt-1 text-sm opacity-70">Update the basics shown on the community page.</p>

          <form action={saveSettings} className="mt-4 space-y-4">
            <input type="hidden" name="communityId" value={community.id} />
            <input type="hidden" name="canonicalHandle" value={canonicalHandle} />

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                name="name"
                defaultValue={community.name}
                className="h-10 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="description">
                Mission / description
              </label>
              <textarea
                id="description"
                name="description"
                defaultValue={community.description ?? ""}
                rows={5}
                className="w-full rounded-xl border bg-transparent p-3 text-sm outline-none"
                placeholder="What is this community about?"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPublicDirectory" defaultChecked={community.isPublicDirectory} />
              <span className="opacity-80">Public directory</span>
            </label>

            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm font-medium opacity-90 hover:opacity-100"
            >
              Save
            </button>
          </form>
        </section>

        <section className="rounded-xl border p-4">
          <div className="text-sm font-medium">Handle</div>
          <p className="mt-1 text-sm opacity-70">
            Changing your handle makes the old one return 404 immediately (no redirects). Old handles are
            reclaimable for {HANDLE_POLICY.reclaimWindowDays} days and become public after {HANDLE_POLICY.publicReuseAfterDays} days.
          </p>

          <form action={changeHandle} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="currentHandle" value={canonicalHandle} />
            <input type="hidden" name="communityId" value={community.id} />

            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium" htmlFor="nextHandle">
                New handle
              </label>
              <input
                id="nextHandle"
                name="nextHandle"
                placeholder="new-handle"
                className="h-10 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
              />
              <p className="text-xs opacity-60">Allowed: a-z, 0-9, underscore, hyphen. 3–24 chars.</p>
            </div>

            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm font-medium opacity-90 hover:opacity-100"
            >
              Change handle
            </button>
          </form>
        </section>

        <section className="rounded-xl border p-4">
          <div className="text-sm font-medium">Delete community</div>
          <p className="mt-1 text-sm opacity-70">
            This permanently deletes the community and retires the handle forever.
          </p>

          <form action={deleteCommunity} className="mt-4 space-y-3">
            <input type="hidden" name="currentHandle" value={canonicalHandle} />
            <input type="hidden" name="communityId" value={community.id} />

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="confirm">
                Type DELETE to confirm
              </label>
              <input
                id="confirm"
                name="confirm"
                className="h-10 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
                placeholder="DELETE"
              />
            </div>

            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm font-medium opacity-90 hover:opacity-100"
            >
              Delete
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
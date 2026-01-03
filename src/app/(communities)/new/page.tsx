import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { HANDLE_POLICY, normalizeHandleKey } from "@/lib/handle";

function isValidHandle(h: string) {
  // MVP rule: a-z, 0-9, underscore, hyphen. 3–24 chars.
  return /^[a-z0-9_-]{3,24}$/.test(h);
}

export default async function NewCommunityPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/api/auth/signin");
  }

  async function createCommunity(formData: FormData) {
    "use server";

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) redirect("/api/auth/signin");

    const name = String(formData.get("name") ?? "").trim();
    const descriptionRaw = String(formData.get("description") ?? "").trim();
    const isPublicDirectory = formData.get("isPublicDirectory") === "on";

    const handleInput = String(formData.get("handle") ?? "");
    const handle = normalizeHandleKey(handleInput);

    if (name.length < 2) redirect("/community/new?error=name");
    if (!isValidHandle(handle)) redirect("/community/new?error=handle");

    const now = new Date();

    try {
      await db.$transaction(async (tx) => {
        // 1) Check handle availability / claim rules.
        const existing = await tx.handle.findUnique({
          where: { handle },
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

          // RELEASED
          const isPubliclyAvailable = existing.availableAt
            ? now >= existing.availableAt
            : true;
          if (!isPubliclyAvailable) throw new Error("HANDLE_NOT_AVAILABLE");
        }

        // 2) Create community.
        const created = await tx.community.create({
          data: {
            name,
            description: descriptionRaw || null,
            isPublicDirectory,
            ownerId: userId,
          },
          select: { id: true },
        });

        // 3) Claim handle for the new community.
        if (existing) {
          await tx.handle.update({
            where: { id: existing.id },
            data: {
              status: "ACTIVE",
              ownerType: "COMMUNITY",
              ownerId: created.id,
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
              handle,
              status: "ACTIVE",
              ownerType: "COMMUNITY",
              ownerId: created.id,
              claimedAt: now,
            },
            select: { id: true },
          });
        }

        return created;
      });

      redirect(`/c/${handle}`);
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "UNKNOWN";
      if (msg === "HANDLE_TAKEN") redirect("/community/new?error=handle_taken");
      if (msg === "HANDLE_RETIRED") redirect("/community/new?error=handle_retired");
      if (msg === "HANDLE_NOT_AVAILABLE") redirect("/community/new?error=handle_not_available");
      redirect("/community/new?error=unknown");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create a community</h1>
        <p className="text-sm opacity-70">
          Choose a handle for your community. Handles are used in routes and UI.
        </p>
      </div>

      <form action={createCommunity} className="mt-8 space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            className="h-10 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
            placeholder="Orbit Love"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="handle">
            Handle
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm opacity-60">@</span>
            <input
              id="handle"
              name="handle"
              className="h-10 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
              placeholder="orbit-love"
              required
            />
          </div>
          <p className="text-xs opacity-60">
            Allowed: a-z, 0-9, underscore, hyphen. 3–24 chars.
          </p>
          <p className="text-xs opacity-60">
            Released handles 404 immediately. They become public after {HANDLE_POLICY.publicReuseAfterDays} days.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="description">
            Mission / description (optional)
          </label>
          <textarea
            id="description"
            name="description"
            rows={5}
            className="w-full rounded-xl border bg-transparent p-3 text-sm outline-none"
            placeholder="What is this community about?"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isPublicDirectory" defaultChecked />
          <span className="opacity-80">Public directory</span>
        </label>

        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm font-medium opacity-90 hover:opacity-100"
        >
          Create
        </button>
      </form>
    </div>
  );
}
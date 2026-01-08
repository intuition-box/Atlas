import { redirect } from "next/navigation";

import { db } from "@/lib/database";
import { requireOnboarded } from "@/lib/guards";
import { HANDLE_POLICY, makeHandle, validateHandle } from "@/lib/handle";
const NEW_COMMUNITY_PATH = "/new";
export default async function NewCommunityPage() {
  // Creating a community requires an onboarded user.
  await requireOnboarded(NEW_COMMUNITY_PATH);

  async function createCommunity(formData: FormData) {
    "use server";

    const { userId } = await requireOnboarded(NEW_COMMUNITY_PATH);

    const name = String(formData.get("name") ?? "").trim();
    const descriptionRaw = String(formData.get("description") ?? "").trim();
    const isPublicDirectory = formData.get("isPublicDirectory") === "on";

    const handleInput = String(formData.get("handle") ?? "");
    const v = validateHandle(handleInput);

    if (name.length < 2) redirect(`${NEW_COMMUNITY_PATH}?error=name`);
    if (!v.ok) redirect(`${NEW_COMMUNITY_PATH}?error=handle`);

    try {
      const community = await db.community.create({
        data: {
          name,
          handle: v.normalized,
          description: descriptionRaw || null,
          isPublicDirectory,
          ownerId: userId,
        },
        select: { id: true },
      });

      // Claim handle ledger entry (idempotent if already correct).
      const handle = await makeHandle({
        ownerType: "COMMUNITY",
        ownerId: community.id,
        desired: v.normalized,
      });

      redirect(`/c/${handle}`);
    } catch (e: any) {
      // IMPORTANT: Next.js `redirect()`/`notFound()` throw internal errors.
      // Never swallow those inside server actions.
      const digest = (e as any)?.digest;
      if (typeof digest === "string") {
        if (digest.startsWith("NEXT_REDIRECT")) throw e;
        if (digest.startsWith("NEXT_NOT_FOUND")) throw e;
      }

      console.error("createCommunity failed", e);
      if (process.env.NODE_ENV !== "production") {
        throw e;
      }

      const msg = typeof e?.message === "string" ? e.message : "UNKNOWN";
      if (/taken/i.test(msg)) redirect(`${NEW_COMMUNITY_PATH}?error=handle_taken`);
      if (/retired/i.test(msg)) redirect(`${NEW_COMMUNITY_PATH}?error=handle_retired`);
      if (/available|cooling/i.test(msg)) redirect(`${NEW_COMMUNITY_PATH}?error=handle_not_available`);

      redirect(`${NEW_COMMUNITY_PATH}?error=unknown`);
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
          <p className="text-xs opacity-60">Allowed: a-z, 0-9, hyphen. 3–32 chars.</p>
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
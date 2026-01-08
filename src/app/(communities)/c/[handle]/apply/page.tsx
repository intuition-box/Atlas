import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/database";
import {
  getActiveHandleForOwner,
  normalizeHandleKey,
  resolveCommunityIdFromHandle,
} from "@/lib/handle";

export default async function ApplyPage(props: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await props.params;
  const handleKey = normalizeHandleKey(raw);

  const communityIdFromHandle = await resolveCommunityIdFromHandle(handleKey);
  if (!communityIdFromHandle) return notFound();

  const community = await db.community.findUnique({
    where: { id: communityIdFromHandle },
    select: {
      id: true,
      name: true,
      description: true,
    },
  });

  if (!community) return notFound();

  const activeHandle = await getActiveHandleForOwner({
    ownerType: "COMMUNITY",
    ownerId: community.id,
  });

  const canonicalHandle = activeHandle ?? handleKey;
  const communityId = community.id;

  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    // Adjust this path if you have a dedicated sign-in route.
    redirect("/api/auth/signin");
  }

  const membership = await db.membership.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: {
      status: true,
      role: true,
    },
  });

  const application = await db.application.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: {
      status: true,
    },
  });

  const isAdmin =
    !!userId &&
    (membership?.role === "OWNER" || membership?.role === "ADMIN");

  // If already approved, no need to apply.
  if (membership?.status === "APPROVED") {
    redirect(`/c/${canonicalHandle}`);
  }

  async function submit(formData: FormData) {
    "use server";

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) redirect("/api/auth/signin");

    const motivation = String(formData.get("motivation") ?? "").trim();
    const links = String(formData.get("links") ?? "").trim();

    if (motivation.length < 10) {
      // MVP: hard redirect with a simple query param (avoid client state).
      redirect(`/c/${canonicalHandle}/apply?error=motivation`);
    }

    // Create membership if missing (PENDING by default)
    await db.membership.upsert({
      where: { userId_communityId: { userId, communityId } },
      create: {
        userId,
        communityId,
        status: "PENDING",
      },
      update: {},
    });

    // Create application if missing
    await db.application.upsert({
      where: { userId_communityId: { userId, communityId } },
      create: {
        userId,
        communityId,
        status: "PENDING",
        answers: {
          motivation,
          links,
        },
      },
      update: {
        // If you later allow re-apply, you can update answers here.
      },
    });

    redirect(`/c/${canonicalHandle}?applied=1`);
  }

  const alreadySubmitted = !!application || membership?.status === "PENDING";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Apply to {community.name}</h1>
        <p className="text-sm opacity-70">@{canonicalHandle}</p>
        {community.description ? (
          <p className="text-sm opacity-70">{community.description}</p>
        ) : null}
      </div>

      {alreadySubmitted ? (
        <div className="mt-8 rounded-xl border p-4">
          <div className="text-sm font-medium">Application submitted</div>
          <p className="mt-1 text-sm opacity-70">
            Your application is pending review. You’ll appear in the directory after approval.
          </p>
          <div className="mt-4">
            <Link className="text-sm underline opacity-80" href={`/c/${canonicalHandle}`}>
              Back to community
            </Link>
            {isAdmin ? (
              <div className="mt-2">
                <Link
                  className="text-sm underline opacity-80"
                  href={`/c/${canonicalHandle}/dashboard`}
                >
                  Go to dashboard
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <form action={submit} className="mt-8 space-y-6">
          <div className="space-y-2">
            <label htmlFor="motivation" className="text-sm font-medium">
              Why do you want to join?
            </label>
            <textarea
              id="motivation"
              name="motivation"
              rows={6}
              required
              className="w-full rounded-xl border bg-transparent p-3 text-sm outline-none"
              placeholder="A short note about what you do and how you want to contribute…"
            />
            <p className="text-xs opacity-60">Minimum 10 characters.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="links" className="text-sm font-medium">
              Links (optional)
            </label>
            <input
              id="links"
              name="links"
              className="h-10 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
              placeholder="e.g. https://github.com/you, https://x.com/you"
            />
          </div>

          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm font-medium opacity-90 hover:opacity-100"
          >
            Submit application
          </button>
        </form>
      )}
    </div>
  );
}
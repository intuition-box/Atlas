import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getActiveHandleForOwner, resolveUserIdFromIdOrHandle } from "@/lib/handle";

export default async function UserProfilePage(props: { params: Promise<{ id: string }> }) {
  const { id: raw } = await props.params;
  const userId = await resolveUserIdFromIdOrHandle(raw);
  if (!userId) return notFound();

  const userSelect = {
    id: true,
    name: true,
    avatarUrl: true,
    headline: true,
    bio: true,
    location: true,
    links: true,
    skills: true,
    tags: true,
    createdAt: true,
  } as const;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: userSelect,
  });

  if (!user) return notFound();

  const activeHandle = await getActiveHandleForOwner({ ownerType: "USER", ownerId: userId });

  const attestations = await db.attestation.findMany({
    where: { toUserId: userId },
    take: 50,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      communityId: true,
      type: true,
      note: true,
      createdAt: true,
      fromUser: { select: { id: true, name: true, avatarUrl: true } },
      community: { select: { id: true, name: true } },
    },
  });

  const communityIds = Array.from(new Set(attestations.map((a) => a.communityId)));

  const communityHandles = communityIds.length
    ? await db.handle.findMany({
        where: {
          status: "ACTIVE",
          ownerType: "COMMUNITY",
          ownerId: { in: communityIds },
        },
        select: { ownerId: true, handle: true },
      })
    : [];

  const communityHandleById = new Map(communityHandles.map((h) => [h.ownerId!, h.handle] as const));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-start gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-2xl border bg-black/5 dark:bg-white/10">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {user.name ?? "Unknown"}
          </h1>
          {activeHandle ? <p className="mt-1 text-sm opacity-60">@{activeHandle}</p> : null}
          {user.headline ? <p className="mt-1 text-sm opacity-70">{user.headline}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2 text-xs opacity-70">
            {user.location ? <span className="rounded-full border px-2 py-1">{user.location}</span> : null}
            {user.skills.slice(0, 6).map((s) => (
              <span key={s} className="rounded-full border px-2 py-1">
                {s}
              </span>
            ))}
          </div>
        </div>
      </header>

      {user.bio ? (
        <section className="mt-6 rounded-xl border p-4">
          <h2 className="text-sm font-medium opacity-80">About</h2>
          <p className="mt-2 text-sm opacity-80 whitespace-pre-wrap">{user.bio}</p>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl border p-4">
        <h2 className="text-sm font-medium opacity-80">Attestations</h2>

        {attestations.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">No attestations yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {attestations.map((a) => (
              <div key={a.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 overflow-hidden rounded-full border bg-black/5 dark:bg-white/10">
                      {a.fromUser.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.fromUser.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">{a.fromUser.name ?? "Unknown"}</span>
                      <span className="opacity-60"> · {a.type}</span>
                    </div>
                  </div>
                  <div className="text-xs opacity-60">{a.createdAt.toDateString()}</div>
                </div>

                {a.note ? <p className="mt-2 text-sm opacity-80">{a.note}</p> : null}

                <div className="mt-2 text-xs opacity-60">
                  {(() => {
                    const ch = communityHandleById.get(a.communityId);
                    if (!ch) return <span>In: {a.community.name}</span>;
                    return (
                      <span>
                        In:{" "}
                        <Link href={`/c/${ch}`} className="underline opacity-80 hover:opacity-100">
                          {a.community.name}
                        </Link>{" "}
                        <span className="opacity-60">@{ch}</span>
                      </span>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
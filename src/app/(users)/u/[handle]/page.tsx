import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/database";
import { resolveUserIdFromHandle } from "@/lib/handle";

export const dynamic = "force-dynamic";

export default async function UserProfilePage(props: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await props.params;

  const userId = await resolveUserIdFromHandle(handle);
  if (!userId) return notFound();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      handle: true,
      name: true,
      avatarUrl: true,
      headline: true,
      bio: true,
      location: true,
      links: true,
      skills: true,
      tags: true,
      createdAt: true,
    },
  });

  if (!user) return notFound();

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
      fromUser: { select: { id: true, name: true, avatarUrl: true, handle: true } },
      community: { select: { id: true, name: true, handle: true } },
    },
  });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-start gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-2xl border border-border bg-muted">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
            {user.name ?? "Unknown"}
          </h1>
          {user.handle ? (
            <p className="mt-1 text-sm text-foreground/60">@{user.handle}</p>
          ) : null}
          {user.headline ? (
            <p className="mt-1 text-sm text-foreground/70">{user.headline}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap gap-2 text-xs text-foreground/70">
            {user.location ? (
              <span className="rounded-full border border-border px-2 py-1">
                {user.location}
              </span>
            ) : null}
            {(user.skills ?? []).slice(0, 6).map((s) => (
              <span key={s} className="rounded-full border border-border px-2 py-1">
                {s}
              </span>
            ))}
          </div>
        </div>
      </header>

      {user.bio ? (
        <section className="mt-6 rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-foreground/80">About</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">
            {user.bio}
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium text-foreground/80">Attestations</h2>

        {attestations.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">No attestations yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {attestations.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 overflow-hidden rounded-full border border-border bg-muted">
                      {a.fromUser.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.fromUser.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="text-sm text-foreground">
                      <span className="font-medium">
                        {a.fromUser.name ?? "Unknown"}
                      </span>
                      <span className="text-foreground/60"> · {a.type}</span>
                    </div>
                  </div>
                  <div className="text-xs text-foreground/60">
                    {a.createdAt.toDateString()}
                  </div>
                </div>

                {a.note ? (
                  <p className="mt-2 text-sm text-foreground/80">{a.note}</p>
                ) : null}

                <div className="mt-2 text-xs text-foreground/60">
                  {a.community.handle ? (
                    <span>
                      In:{" "}
                      <Link
                        href={`/c/${a.community.handle}`}
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {a.community.name}
                      </Link>{" "}
                      <span className="text-foreground/60">@{a.community.handle}</span>
                    </span>
                  ) : (
                    <span>In: {a.community.name}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
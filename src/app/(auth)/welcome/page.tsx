import { redirect } from "next/navigation";

import ProfileOnboardingForm from "@/components/onboarding/profile-onboarding-form";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;

  if (!userId) redirect("/signin?returnTo=/welcome");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      handle: true,
      avatarUrl: true,
      image: true,
      headline: true,
      bio: true,
      location: true,
      links: true,
      skills: true,
      tags: true,
    },
  });

  if (!user) redirect("/signin?returnTo=/welcome");

  // Onboarding is complete once a handle is set.
  if (user.handle) redirect(`/u/${user.handle}`);

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Welcome
        </h1>
        <p className="mt-1 text-sm text-foreground/70">
          Set up your profile to start joining communities.
        </p>
      </div>

      <ProfileOnboardingForm
        initial={{
          name: user.name ?? "",
          handle: "",
          avatarUrl: user.avatarUrl ?? user.image ?? "",
          headline: user.headline ?? "",
          bio: user.bio ?? "",
          location: user.location ?? "",
          links: (user.links as string[] | null) ?? [],
          skills: (user.skills as string[] | null) ?? [],
          tags: (user.tags as string[] | null) ?? [],
        }}
      />
    </div>
  );
}
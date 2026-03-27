import Link from "next/link";
import { Lock } from "lucide-react";

import { requireOnboardedRedirect } from "@/lib/auth/policy";
import { ROUTES } from "@/lib/routes";

import { PageHeader } from "@/components/common/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Controls who can create communities:
 * - Default (nothing set) → open for all onboarded users
 * - ALLOWED_COMMUNITY_CREATORS="id1,id2" → only those users
 * - COMMUNITY_CREATION_DISABLED=true → only ALLOWED_COMMUNITY_CREATORS (if set), otherwise nobody
 */
function isCreationAllowed(userId: string): boolean {
  const allowlist = (process.env.ALLOWED_COMMUNITY_CREATORS ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean);

  if (allowlist.length > 0) return allowlist.includes(userId);

  return process.env.COMMUNITY_CREATION_DISABLED !== "true";
}

export default async function NewCommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await requireOnboardedRedirect("/new");

  if (!isCreationAllowed(userId)) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
        <PageHeader
          leading={
            <Avatar className="h-12 w-12 has-[[data-slot=avatar-fallback]]:after:border-primary/15">
              <AvatarFallback className="bg-primary/10 text-primary">
                <Lock className="size-5" />
              </AvatarFallback>
            </Avatar>
          }
          title="New Community"
          description="Create and launch your own community"
        />

        <Card>
          <CardHeader>
            <CardTitle>Invite only</CardTitle>
            <CardDescription>
              Creating communities is temporarily available by invite only while
              we refine the experience. We&apos;ll open it up to everyone soon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href={ROUTES.home} />}>
              Back to home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

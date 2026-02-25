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
 * Comma-separated list of handles allowed to create communities.
 * e.g. ALLOWED_COMMUNITY_CREATORS="saulo,alice,bob"
 * When unset or empty, the page is blocked for everyone.
 */
function getAllowedHandles(): Set<string> {
  const raw = process.env.ALLOWED_COMMUNITY_CREATORS ?? "";
  const handles = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set(handles);
}

export default async function NewCommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { handle } = await requireOnboardedRedirect("/new");
  const allowed = getAllowedHandles();

  if (!allowed.has(handle.toLowerCase())) {
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

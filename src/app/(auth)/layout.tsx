import { headers } from "next/headers"

import { requireAuthRedirect, requireOnboardedRedirect } from "@/lib/guards"
import { ROUTES } from "@/lib/routes"

async function getPathnameFromHeaders(): Promise<string> {
  const h = await headers()

  const raw =
    h.get("next-url") ||
    h.get("x-next-url") ||
    h.get("x-url") ||
    h.get("x-invoke-path") ||
    h.get("x-matched-path") ||
    ""

  // `next-url` is usually a pathname ("/signin"), but may include a query.
  const pathname = raw.split("?")[0] ?? ""
  return pathname.startsWith("/") ? pathname : ""
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const pathname = await getPathnameFromHeaders()

  // `/signin` must be public, otherwise we create a redirect loop.
  if (pathname === ROUTES.signIn) {
    return <>{children}</>
  }

  // Onboarding must be accessible to signed-in users who are not onboarded yet.
  if (pathname === ROUTES.onboarding) {
    await requireAuthRedirect()
    return <>{children}</>
  }

  // All other routes in this group require a fully onboarded user.
  await requireOnboardedRedirect()

  return <>{children}</>
}
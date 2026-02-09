"use client";

import { useEffect, useRef } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ROUTES, isPublicRoute, isOnboardingRoute } from "@/lib/routes";
import { resetCsrf, initCsrfVisibilityRefresh } from "@/lib/api/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavigationProvider } from "@/components/navigation/navigation-provider";
import { AttestationQueueProvider } from "@/components/attestation/attestation-queue-provider";
import { useGlobalSound } from "@/hooks/use-global-sound";

/**
 * Manages CSRF token lifecycle:
 * - Initializes visibility-based refresh (reset token when tab becomes visible)
 * - Resets token on session changes (login/logout)
 */
function CsrfManager({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const prevSessionIdRef = useRef<string | null | undefined>(undefined);

  // Initialize visibility-based CSRF refresh
  useEffect(() => {
    const cleanup = initCsrfVisibilityRefresh();
    return cleanup;
  }, []);

  // Reset CSRF token when session changes (login/logout/switch user)
  useEffect(() => {
    if (status === "loading") return;

    const currentSessionId = session?.user?.id ?? null;
    const prevSessionId = prevSessionIdRef.current;

    // Skip initial mount (when prevSessionId is undefined)
    if (prevSessionId !== undefined && prevSessionId !== currentSessionId) {
      resetCsrf();
    }

    prevSessionIdRef.current = currentSessionId;
  }, [session?.user?.id, status]);

  return <>{children}</>;
}

/**
 * Client-side guard for onboarding flow:
 * - NOT onboarded: always redirect to /onboarding (except public routes)
 * - Onboarded: never allow /onboarding, redirect to returnToUrl or home
 */
function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status, update } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Force session refresh on mount to get latest onboarded status
  useEffect(() => {
    if (status === "authenticated") {
      update();
    }
  }, []);

  // Determine if we need to redirect
  const needsRedirect = (() => {
    if (status === "loading") return false;
    if (!session?.user) return false;

    const isOnboarded = session.user.onboarded;
    const onOnboardingPage = isOnboardingRoute(pathname);
    const onPublicRoute = isPublicRoute(pathname);

    if (!isOnboarded && !onOnboardingPage && !onPublicRoute) return true;
    if (isOnboarded && onOnboardingPage) return true;

    return false;
  })();

  useEffect(() => {
    // Wait for session to load
    if (status === "loading") return;

    // No session = not logged in, let them browse public routes or get redirected by auth
    if (!session?.user) return;

    const isOnboarded = session.user.onboarded;
    const onOnboardingPage = isOnboardingRoute(pathname);
    const onPublicRoute = isPublicRoute(pathname);

    if (!isOnboarded) {
      // NOT onboarded: must go to onboarding page
      if (!onOnboardingPage && !onPublicRoute) {
        const returnTo = encodeURIComponent(pathname);
        router.replace(`${ROUTES.onboarding}?returnToUrl=${returnTo}`);
      }
    } else {
      // Onboarded: never show onboarding page again
      if (onOnboardingPage) {
        const returnToUrl = searchParams.get("returnToUrl");
        const destination = returnToUrl && returnToUrl.startsWith("/") ? returnToUrl : ROUTES.home;
        router.replace(destination);
      }
    }
  }, [session, status, pathname, searchParams, router]);

  // Show nothing while checking or redirecting to prevent flash
  if (status === "loading" || needsRedirect) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Registers global event listeners (hover sounds, etc.)
 * that don't render any UI.
 */
function GlobalListeners({ children }: { children: React.ReactNode }) {
  useGlobalSound();
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={true} refetchInterval={0}>
      <CsrfManager>
        <GlobalListeners>
          <TooltipProvider delay={300}>
            <NavigationProvider>
              <AttestationQueueProvider>
                <OnboardingGuard>{children}</OnboardingGuard>
              </AttestationQueueProvider>
            </NavigationProvider>
          </TooltipProvider>
        </GlobalListeners>
      </CsrfManager>
    </SessionProvider>
  );
}

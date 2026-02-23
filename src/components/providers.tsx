"use client";

import { useCallback, useEffect, useRef } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ROUTES, isPublicRoute, isOnboardingRoute, userSettingsPath } from "@/lib/routes";
import { apiPost, resetCsrf, initCsrfVisibilityRefresh } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavigationProvider } from "@/components/navigation/navigation-provider";
import { AttestationQueueProvider } from "@/components/attestation/queue-provider";
import { WalletProvider } from "@/components/wallet-provider";
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

/** Interval between heartbeat pings (5 minutes). */
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Periodically pings POST /api/user/heartbeat to keep `User.lastActiveAt`
 * (and `Membership.lastActiveAt`) fresh. Pauses when the tab is hidden and
 * resumes immediately when it becomes visible again.
 */
function HeartbeatManager({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ping = useCallback(() => {
    // Fire-and-forget — we don't care about the response.
    void apiPost("/api/user/heartbeat", {});
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;

    // Ping immediately on mount / when session becomes authenticated.
    ping();

    function start() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    }

    function stop() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        ping();
        start();
      } else {
        stop();
      }
    }

    // Start interval if tab is already visible.
    if (document.visibilityState === "visible") {
      start();
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status, ping]);

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
        // Only pass returnToUrl for meaningful deep-link pages (not "/").
        const hasDeepLink = pathname.length > 1;
        const url = hasDeepLink
          ? `${ROUTES.onboarding}?returnToUrl=${encodeURIComponent(pathname)}`
          : ROUTES.onboarding;
        router.replace(url);
      }
    } else {
      // Onboarded: never show onboarding page again
      if (onOnboardingPage) {
        const returnToUrl = searchParams.get("returnToUrl");
        // Only honour returnToUrl when it points to a real page (not just "/").
        if (returnToUrl && returnToUrl.length > 1 && returnToUrl.startsWith("/")) {
          router.replace(returnToUrl);
        } else {
          // After first-time onboarding, redirect to settings so the user can
          // review their profile and connect socials / wallet.
          const handle = session.user.handle;
          router.replace(handle ? userSettingsPath(handle) : ROUTES.home);
        }
      }
    }
  }, [session, status, pathname, searchParams, router]);

  // Play celebration sound after first-time onboarding redirect.
  // Skip while still on the onboarding page — the effect re-fires once the
  // pathname changes to the destination, so the sound plays exactly once on
  // the settings page (and the AudioContext stays unlocked via client-side nav).
  useEffect(() => {
    if (status !== "authenticated") return;
    if (isOnboardingRoute(pathname)) return;
    try {
      if (sessionStorage.getItem("atlas-onboarded") === "1") {
        sessionStorage.removeItem("atlas-onboarded");
        // Small delay to let the page render before playing
        const t = setTimeout(() => { void sounds.onboarding(); }, 400);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [status, pathname]);

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
      <WalletProvider>
      <CsrfManager>
        <HeartbeatManager>
          <GlobalListeners>
            <TooltipProvider delay={300}>
              <NavigationProvider>
                <AttestationQueueProvider>
                  <OnboardingGuard>{children}</OnboardingGuard>
                </AttestationQueueProvider>
              </NavigationProvider>
            </TooltipProvider>
          </GlobalListeners>
        </HeartbeatManager>
      </CsrfManager>
      </WalletProvider>
    </SessionProvider>
  );
}

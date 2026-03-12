"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { HelpCircle, Compass, Users, Award, Globe, UserCog } from "lucide-react";

import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/routes";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTour } from "./tour-provider";
import {
  createWelcomeTour,
  createProfileSetupTour,
  createFirstEndorsementTour,
  createPublishingTour,
  createJoiningCommunityTour,
} from "./tour-definitions";

/* ────────────────────────────
   Types
──────────────────────────── */

type TourHelpButtonProps = {
  className?: string;
};

/* ────────────────────────────
   Component
──────────────────────────── */

export function TourHelpButton({ className }: TourHelpButtonProps) {
  const { startTour, isRunning } = useTour();
  const { data: session } = useSession();
  const router = useRouter();
  const handle = session?.user?.handle;
  const isAuthed = !!handle;

  /** Start the tour if authenticated, otherwise redirect to sign-in. */
  function requireAuth(factory: () => ReturnType<typeof createPublishingTour>) {
    if (isAuthed) {
      startTour(factory());
    } else {
      router.push(ROUTES.signIn);
    }
  }

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger>
          <MenuTrigger
            disabled={isRunning}
            className={cn(
              "flex items-center justify-center cursor-pointer",
              "size-8 rounded-full",
              "text-muted-foreground hover:bg-input/50 hover:text-foreground",
              "transition-all duration-200",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              "disabled:opacity-50 disabled:pointer-events-none",
              className,
            )}
          >
            <HelpCircle className="size-4" />
          </MenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          <p className="text-xs">Guided tours</p>
        </TooltipContent>
      </Tooltip>
      <MenuContent side="bottom" align="end" sideOffset={8} className="w-auto">
        <MenuGroup>
          <MenuLabel>Guided Tours</MenuLabel>
          <MenuItem onClick={() => startTour(createWelcomeTour(isAuthed))}>
            <Compass className="size-4" />
            Welcome to Atlas
          </MenuItem>
          <MenuItem onClick={() => requireAuth(() => createProfileSetupTour(handle!))}>
            <UserCog className="size-4" />
            Set your profile
          </MenuItem>
          <MenuItem onClick={() => startTour(createFirstEndorsementTour(handle ?? null))}>
            <Award className="size-4" />
            First Endorsement
          </MenuItem>
          <MenuItem onClick={() => startTour(createJoiningCommunityTour())}>
            <Users className="size-4" />
            Joining a Community
          </MenuItem>
          <MenuItem onClick={() => requireAuth(() => createPublishingTour(handle!))}>
            <Globe className="size-4" />
            Publishing Attestations
          </MenuItem>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

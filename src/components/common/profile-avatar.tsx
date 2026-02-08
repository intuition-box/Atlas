"use client";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { UserIcon, GlobeIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface ProfileAvatarProps {
  /** "user" shows UserIcon fallback, "community" shows GlobeIcon */
  type: "user" | "community";
  src?: string | null;
  name?: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}

const FALLBACK_ICON_SIZE: Record<NonNullable<ProfileAvatarProps["size"]>, string> = {
  sm: "size-3",
  default: "size-4",
  lg: "size-5",
};

export function ProfileAvatar({
  type,
  src,
  name,
  size = "default",
  className,
}: ProfileAvatarProps) {
  const FallbackIcon = type === "community" ? GlobeIcon : UserIcon;

  return (
    <Avatar size={size} className={className}>
      <AvatarImage src={src ?? undefined} alt={name ?? ""} />
      <AvatarFallback>
        <FallbackIcon
          className={cn("text-muted-foreground", FALLBACK_ICON_SIZE[size])}
        />
      </AvatarFallback>
    </Avatar>
  );
}

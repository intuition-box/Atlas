import { ATTESTATION_TYPES, type AttestationType } from "@/lib/attestations/definitions";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type AttestationBadgeProps = {
  /** Attestation type key (e.g. "TRUST", "FOLLOW") */
  type: string;
  /** Show emoji before the label. Defaults to true. */
  showEmoji?: boolean;
  /** Show only the emoji, no label text. Useful for endorsements where the attribute label is shown separately. */
  emojiOnly?: boolean;
  /** Render as plain text instead of a styled badge. Use inside buttons, spans, etc. */
  bare?: boolean;
  /** Badge variant — defaults to "outline". Ignored when bare. */
  variant?: VariantProps<typeof badgeVariants>["variant"];
  /** Additional className. Ignored when bare. */
  className?: string;
};

export function AttestationBadge({
  type,
  showEmoji = true,
  emojiOnly = false,
  bare = false,
  variant = "secondary",
  className,
}: AttestationBadgeProps) {
  const def = ATTESTATION_TYPES[type as AttestationType];
  const label = def?.label ?? type;
  const emoji = def?.emoji;

  const content = (
    <>
      {showEmoji && emoji && <span>{emoji}</span>}
      {!emojiOnly && label}
    </>
  );

  if (bare) {
    return (
      <span className="inline-flex items-center gap-2">
        {content}
      </span>
    );
  }

  return (
    <Badge variant={variant} className={cn("flex items-center gap-2 text-xs", className)}>
      {content}
    </Badge>
  );
}

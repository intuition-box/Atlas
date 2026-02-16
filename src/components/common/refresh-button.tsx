"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type RefreshButtonProps = {
  /**
   * Optional callback fired *before* `router.refresh()`.
   * Use this for client-side state resets (e.g. re-fetching data).
   */
  onRefresh?: () => void;

  /** Additional className for the button. */
  className?: string;
};

function RefreshButton({ onRefresh, className }: RefreshButtonProps) {
  const router = useRouter();

  function handleClick() {
    onRefresh?.();
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={handleClick}
      className={className}
    >
      Refresh
    </Button>
  );
}

export { RefreshButton };
export type { RefreshButtonProps };

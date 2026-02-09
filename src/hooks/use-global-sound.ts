"use client";

import { useEffect } from "react";

import { sounds } from "@/lib/sounds";

/**
 * Selector for interactive elements that should trigger hover sounds.
 * Covers buttons, links, and elements with role="button".
 */
const INTERACTIVE_SELECTOR = 'button, a, [role="button"]';

/**
 * Global event delegation for hover sounds.
 *
 * Listens for `mouseenter` on the document and plays the hover sound
 * when the target (or nearest ancestor) matches an interactive element.
 * This eliminates the need for per-component `onMouseEnter` handlers.
 *
 * Call once near the root of your app (e.g., in providers or layout).
 */
export function useGlobalSound() {
  useEffect(() => {
    function handleMouseOver(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const interactive = target.closest(INTERACTIVE_SELECTOR);
      if (!interactive) return;

      // Skip disabled elements
      if (
        interactive instanceof HTMLButtonElement && interactive.disabled ||
        interactive.getAttribute("aria-disabled") === "true"
      ) {
        return;
      }

      sounds.play("hover", { spatial: true });
    }

    // `mouseover` bubbles (unlike `mouseenter`), so delegation works.
    // We use `mouseover` but only trigger on the closest interactive element
    // to avoid re-firing when moving between child elements.
    //
    // Track last-hovered element to deduplicate — mouseover fires on every
    // child, but we only want one sound per interactive boundary crossing.
    let lastHovered: Element | null = null;

    function handleMouseOverDeduped(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const interactive = target.closest(INTERACTIVE_SELECTOR);
      if (!interactive) {
        lastHovered = null;
        return;
      }

      // Same interactive element — skip
      if (interactive === lastHovered) return;
      lastHovered = interactive;

      // Skip disabled elements
      if (
        interactive instanceof HTMLButtonElement && interactive.disabled ||
        interactive.getAttribute("aria-disabled") === "true"
      ) {
        return;
      }

      sounds.play("hover", { spatial: true });
    }

    document.addEventListener("mouseover", handleMouseOverDeduped, { passive: true });

    return () => {
      document.removeEventListener("mouseover", handleMouseOverDeduped);
    };
  }, []);
}

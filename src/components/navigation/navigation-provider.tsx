"use client";

import * as React from "react";
import type { NavigationButtonProps } from "./navigation-button";

/* ────────────────────────────
   Types
──────────────────────────── */

export type NavigationItem = Omit<NavigationButtonProps, "className">;

export type NavigationSlot = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export type NavigationControls = {
  [K in NavigationSlot]?: NavigationItem[];
};

type NavigationContextValue = {
  controls: NavigationControls;
  setControls: (slot: NavigationSlot, items: NavigationItem[]) => void;
  clearControls: (slot: NavigationSlot) => void;
  clearAllControls: () => void;
  isVisible: boolean;
  setIsVisible: (visible: boolean) => void;
};

/* ────────────────────────────
   Context
──────────────────────────── */

const NavigationContext = React.createContext<NavigationContextValue | null>(null);

/* ────────────────────────────
   Provider
──────────────────────────── */

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [controls, setControlsState] = React.useState<NavigationControls>({});
  const [isVisible, setIsVisible] = React.useState(true);

  const setControls = React.useCallback((slot: NavigationSlot, items: NavigationItem[]) => {
    setControlsState((prev) => ({ ...prev, [slot]: items }));
  }, []);

  const clearControls = React.useCallback((slot: NavigationSlot) => {
    setControlsState((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }, []);

  const clearAllControls = React.useCallback(() => {
    setControlsState({});
  }, []);

  const value = React.useMemo(
    () => ({
      controls,
      setControls,
      clearControls,
      clearAllControls,
      isVisible,
      setIsVisible,
    }),
    [controls, setControls, clearControls, clearAllControls, isVisible]
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

/* ────────────────────────────
   Hooks
──────────────────────────── */

export function useNavigationContext() {
  const context = React.useContext(NavigationContext);
  if (!context) {
    throw new Error("useNavigationContext must be used within NavigationProvider");
  }
  return context;
}

/**
 * Hook for pages to register contextual navigation controls.
 * Controls are automatically cleared when the component unmounts.
 */
export function useNavigation(controls: NavigationControls) {
  const { setControls, clearControls } = useNavigationContext();

  React.useEffect(() => {
    const slots = Object.keys(controls) as NavigationSlot[];

    // Set controls for each slot
    for (const slot of slots) {
      const items = controls[slot];
      if (items && items.length > 0) {
        setControls(slot, items);
      }
    }

    // Cleanup: clear controls on unmount
    return () => {
      for (const slot of slots) {
        clearControls(slot);
      }
    };
  }, [controls, setControls, clearControls]);
}

/**
 * Hook to toggle navigation visibility (eye icon functionality).
 */
export function useNavigationVisibility() {
  const { isVisible, setIsVisible } = useNavigationContext();

  const toggle = React.useCallback(() => {
    setIsVisible(!isVisible);
  }, [isVisible, setIsVisible]);

  return { isVisible, setIsVisible, toggle };
}

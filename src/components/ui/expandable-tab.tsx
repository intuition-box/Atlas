"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useOnClickOutside } from "usehooks-ts";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Types ──────────────────────────────────────────────────────────

export interface Tab {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Per-tab active color override (e.g. "text-amber-500"). */
  activeColor?: string;
  /** Per-tab active background override (e.g. "bg-amber-500/10"). */
  activeBg?: string;
  type?: "tab";
}

export interface Separator {
  type: "separator";
}

export type TabItem = Tab | Separator;

export interface ExpandableTabsProps {
  tabs: TabItem[];
  className?: string;
  /** Default active color for all tabs. */
  activeColor?: string;
  /**
   * Controlled active index. When provided the component is fully controlled —
   * no internal state and no click-outside-to-deselect behaviour.
   */
  activeIndex?: number | null;
  /** Called when a tab is clicked. */
  onChange?: (index: number | null) => void;
  /**
   * Custom render wrapper for each tab (e.g. wrapping in `<Link>`).
   * Must forward children and spread any necessary props.
   */
  renderTab?: (props: {
    children: React.ReactNode;
    index: number;
    tab: Tab;
  }) => React.ReactElement;
}

// ── Animation variants ─────────────────────────────────────────────

const buttonVariants = {
  initial: {
    gap: 0,
    paddingLeft: ".5rem",
    paddingRight: ".5rem",
  },
  animate: (isSelected: boolean) => ({
    gap: isSelected ? ".5rem" : 0,
    paddingLeft: isSelected ? "1rem" : ".5rem",
    paddingRight: isSelected ? "1rem" : ".5rem",
  }),
};

const spanVariants = {
  initial: { width: 0, opacity: 0 },
  animate: { width: "auto", opacity: 1 },
  exit: { width: 0, opacity: 0 },
};

const transition = {
  delay: 0.1,
  type: "spring" as const,
  bounce: 0,
  duration: 0.6,
};

// ── Tab with tooltip ────────────────────────────────────────────────

/** Fully controlled tooltip that suppresses hover when the tab is active. */
function TabWithTooltip({
  tab,
  isActive,
  children,
}: {
  tab: Tab;
  isActive: boolean;
  children: React.ReactElement;
}) {
  const [hovered, setHovered] = React.useState(false);

  // Force-close when tab becomes active
  React.useEffect(() => {
    if (isActive) setHovered(false);
  }, [isActive]);

  return (
    <Tooltip open={hovered && !isActive} onOpenChange={setHovered}>
      <TooltipTrigger>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {tab.title}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Component ──────────────────────────────────────────────────────

export function ExpandableTabs({
  tabs,
  className,
  activeColor = "text-primary",
  activeIndex,
  onChange,
  renderTab,
}: ExpandableTabsProps) {
  const isControlled = activeIndex !== undefined;
  const [internalSelected, setInternalSelected] = React.useState<number | null>(
    null,
  );
  const selected = isControlled ? activeIndex : internalSelected;

  const outsideClickRef = React.useRef<HTMLDivElement>(null!);

  // Only use click-outside-to-deselect in uncontrolled mode
  useOnClickOutside(outsideClickRef, () => {
    if (isControlled) return;
    setInternalSelected(null);
    onChange?.(null);
  });

  const handleSelect = (index: number) => {
    if (!isControlled) {
      setInternalSelected(index);
    }
    onChange?.(index);
  };

  return (
    <TooltipProvider delay={200} closeDelay={0}>
      <div
        ref={outsideClickRef}
        className={cn(
          "flex flex-wrap items-center gap-1 rounded-full border border-border bg-input/30 bg-clip-padding px-1 py-[3px]",
          className,
        )}
      >
        {tabs.map((tab, index) => {
          if (tab.type === "separator") {
            return (
              <div
                key={`separator-${index}`}
                className="mx-1 h-[24px] w-[1.2px] bg-border"
                aria-hidden="true"
              />
            );
          }

          const Icon = tab.icon;
          const isActive = selected === index;
          const color = tab.activeColor ?? activeColor;
          const bg = tab.activeBg ?? "bg-primary/10";

          const inner = (
            <motion.span
              key={tab.title}
              variants={buttonVariants}
              initial={isControlled ? "animate" : "initial"}
              animate="animate"
              custom={isActive}
              transition={transition}
              className={cn(
                "relative flex items-center rounded-full px-4 py-2 text-sm leading-none font-medium transition-colors duration-300",
                isActive
                  ? cn(bg, color)
                  : "text-muted-foreground hover:bg-input/50 hover:text-foreground",
              )}
              onClick={() => handleSelect(index)}
            >
              <Icon size={16} />
              <AnimatePresence initial={false}>
                {isActive && (
                  <motion.span
                    variants={spanVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={transition}
                    className="overflow-hidden"
                  >
                    {tab.title}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.span>
          );

          const wrapped = renderTab
            ? renderTab({ children: inner, index, tab })
            : inner;

          return (
            <TabWithTooltip key={tab.title} tab={tab} isActive={isActive}>
              {wrapped}
            </TabWithTooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn()` is our single className helper.
 *
 * It does two things:
 * - Combines conditional class values (via `clsx`).
 * - Dedupes/conflict-resolves Tailwind utilities (via `tailwind-merge`).
 *
 * Why the overloads?
 * - Base UI primitives support `className` as either a string **or** a `(state) => string` function.
 * - DOM elements (`div`, `textarea`, etc.) only accept `className: string`.
 *
 * So `cn()` is overloaded:
 * - If you pass only string/clsx values, it returns a **string**.
 * - If you pass any function-valued input, it returns a **(state) => string** function.
 *
 * Examples:
 * ```ts
 * // DOM element (string only)
 * <div className={cn("p-4", isActive && "bg-muted")} />
 *
 * // Base UI primitive (state function)
 * <SomeBaseUiThing
 *   className={cn(
 *     "px-2",
 *     (s) => s.disabled && "opacity-50",
 *     (s) => s.active && "bg-muted",
 *   )}
 * />
 *
 * // Important: DOM elements only accept string className.
 * // So only pass string/clsx values to `cn()` for DOM elements.
 * ```
 */

type CnValue<State> = ClassValue | ((state: State) => ClassValue);

export function cn(...inputs: ClassValue[]): string;
export function cn<State>(...inputs: CnValue<State>[]): (state: State) => string;
export function cn<State>(...inputs: CnValue<State>[]) {
  const hasFn = inputs.some((v) => typeof v === "function");

  if (!hasFn) {
    return twMerge(clsx(inputs as ClassValue[]));
  }

  return (state: State) => {
    const resolved = inputs.map((v) =>
      typeof v === "function" ? (v as (s: State) => ClassValue)(state) : v,
    );

    return twMerge(clsx(resolved as ClassValue[]));
  };
}
import { z } from "zod";

import type { ApiError, Result } from "@/lib/api-shapes";
import { err, ok } from "@/lib/api-shapes";
import { isReservedHandle } from "@/config/reserved-handles";

/**
 * Handle policy (client-safe).
 *
 * This file defines what a *valid handle string* looks like. It does NOT deal with:
 * - uniqueness
 * - cooldown / reclaim windows
 * - retirement
 *
 * Those lifecycle rules live server-side in `src/lib/handle-registry.ts`.
 */

// Keep these in sync with the DB schema.
export const MIN_HANDLE_LEN = 3;
export const MAX_HANDLE_LEN = 32;

/** Canonical handle regex: lowercase segments separated by single hyphens. */
export const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Hyphen-insensitive handle key used for collision prevention.
 *
 * Example:
 * - "saulo-santos" -> "saulosantos"
 * - "saulosantos" -> "saulosantos"
 */
export function handleKey(name: string): string {
  return name.replace(/-/g, "");
}

export type HandleValidationCode =
  | "HANDLE_TOO_SHORT"
  | "HANDLE_TOO_LONG"
  | "HANDLE_INVALID_FORMAT"
  | "HANDLE_RESERVED";

export type HandleValidationProblem = ApiError<
  HandleValidationCode,
  400,
  {
    /** Always included so callers can show what was actually parsed/normalized. */
    normalized: string;
  }
>;

export type HandleValidationResult = Result<string, HandleValidationProblem>;

/**
 * Normalize user input to canonical *shape*.
 *
 * Normalization is intentionally conservative:
 * - It does not attempt to convert arbitrary characters into valid ones.
 * - It does normalize common separators to avoid bypasses.
 */
export function normalizeHandle(input: string): string {
  let s = input.trim().toLowerCase();

  // Normalize Unicode dashes to ASCII hyphen-minus (common on mobile copy/paste).
  try {
    s = s.replace(/[\p{Pd}]+/gu, "-");
  } catch {
    s = s.replace(/[\u2010-\u2015]/g, "-");
  }

  // Prevent reserved-handle bypass via underscores.
  s = s.replace(/_+/g, "-");

  // Convert whitespace and dots to hyphens.
  s = s.replace(/[\s.]+/g, "-");

  // Collapse repeats and trim.
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  return s;
}

function validateNormalizedHandle(normalized: string): HandleValidationResult {
  if (normalized.length < MIN_HANDLE_LEN) {
    return err({
      code: "HANDLE_TOO_SHORT",
      message: "Handle is too short",
      status: 400,
      meta: { normalized },
    });
  }

  if (normalized.length > MAX_HANDLE_LEN) {
    return err({
      code: "HANDLE_TOO_LONG",
      message: "Handle is too long",
      status: 400,
      meta: { normalized },
    });
  }

  if (!HANDLE_PATTERN.test(normalized)) {
    return err({
      code: "HANDLE_INVALID_FORMAT",
      message: "Invalid handle",
      status: 400,
      meta: { normalized },
    });
  }

  if (isReservedHandle(normalized)) {
    return err({
      code: "HANDLE_RESERVED",
      message: "Handle is reserved",
      status: 400,
      meta: { normalized },
    });
  }

  return ok(normalized);
}

/**
 * Validate arbitrary input.
 * Returns the canonical handle on success.
 */
export function validateHandle(input: string): HandleValidationResult {
  return validateNormalizedHandle(normalizeHandle(input));
}

/**
 * Parse + validate a handle.
 *
 * This is a small alias used by server-side code that wants an explicit Result.
 */
export function parseHandle(input: string): HandleValidationResult {
  return validateHandle(input);
}

/**
 * Parse + validate. Returns the canonical handle or throws.
 *
 * Server-side code uses this before touching the DB.
 */
export function assertValidHandle(input: string): string {
  const r = validateHandle(input);
  if (r.ok) return r.value;

  // Keep the message generic; callers can use `validateHandle` for UI-level specificity.
  throw new Error(
    "Invalid handle. Use 3–32 lowercase letters/numbers separated by hyphens (e.g. 'saulo' or 'saulo-pt').",
  );
}

/**
 * Best-effort handle candidate from arbitrary input (name/email/etc.).
 *
 * This is client-safe and does not check uniqueness/availability.
 * Returns an empty string when no meaningful suggestion can be derived.
 * Server-side availability/claiming is handled by `src/lib/handle-registry.ts`.
 */
export function makeHandleCandidate(seed: string): string {
  let s = normalizeHandle(seed);

  // Strip accents/diacritics.
  try {
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // ignore
  }

  // Keep only a–z, 0–9, hyphen.
  s = s.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  // If we can't derive anything meaningful, do not suggest a handle.
  // The UI can show a hint like “Type a name/handle”.
  if (!s) return "";

  // Enforce max length early.
  if (s.length > MAX_HANDLE_LEN) {
    s = s.slice(0, MAX_HANDLE_LEN).replace(/-+$/g, "");
  }

  // If it's too short after normalization, do not suggest.
  if (s.length < MIN_HANDLE_LEN) return "";

  // Prefer the plain candidate when valid + not reserved.
  if (isReservedHandle(s)) return "";

  const v = validateNormalizedHandle(s);
  if (v.ok) return v.value;

  return "";
}

/**
 * Zod schema for handles.
 *
 * - Preprocess normalizes
 * - Refinement validates and reports a concise message
 */
export const HandleSchema = z
  .preprocess((v) => (typeof v === "string" ? normalizeHandle(v) : v), z.string())
  .superRefine((v, ctx) => {
    const res = validateNormalizedHandle(v);
    if (res.ok) return;

    ctx.addIssue({ code: "custom", message: res.error.message });
  });

export type HandleInput = z.input<typeof HandleSchema>;
export type Handle = z.output<typeof HandleSchema>;
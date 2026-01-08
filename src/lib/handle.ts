import { z } from "zod";

import { isReservedHandle } from "@/config/reserved-handles";

/**
 * Handle policy (client-safe)
 *
 * Canonical handle form:
 * - lowercase
 * - hyphen-separated segments
 * - a–z, 0–9, hyphen
 *
 * IMPORTANT:
 * - This file must remain client-safe (no db, no @prisma/client, no server-only).
 * - Server-side lifecycle enforcement (claim/release/reclaim/retire) lives in
 *   `src/lib/handle-registry.ts`.
 */
export const MIN_HANDLE_LEN = 3;
export const MAX_HANDLE_LEN = 32;

// Canonical: lowercase, hyphen-separated segments. (We accept '_' in input but normalize to '-')
export const handlePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type HandleValidationReason =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_FORMAT"
  | "RESERVED";

export function normalizeHandle(input: string): string {
  let s = (input ?? "").toString().trim().toLowerCase();

  // Convert underscores to hyphens so users can't bypass reserved handles.
  s = s.replace(/_+/g, "-");

  // Convert whitespace/dots to hyphens, collapse, trim.
  s = s.replace(/[\s.]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  return s;
}

/**
 * Create a best-effort handle *candidate* from an arbitrary seed (name/email/etc.).
 *
 * Notes:
 * - Client-safe (no DB checks). Uniqueness/availability is enforced server-side.
 * - This is intentionally a bit more permissive than `normalizeHandle`:
 *   it strips diacritics and drops unsupported characters.
 */
export function makeHandleCandidate(seed: string): string {
  let s = normalizeHandle(seed);

  // Normalize Unicode dashes to ASCII hyphen-minus
  try {
    s = s.replace(/[\p{Pd}]+/gu, "-");
  } catch {
    s = s.replace(/[\u2010-\u2015]/g, "-");
  }

  // Strip accents/diacritics
  try {
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // ignore
  }

  // Keep only a–z, 0–9, hyphen
  s = s
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!s) s = "user";

  if (s.length > MAX_HANDLE_LEN) {
    s = s.slice(0, MAX_HANDLE_LEN).replace(/-+$/g, "");
  }

  return s;
}

export function validateHandle(input: string): {
  ok: boolean;
  normalized: string;
  reason?: HandleValidationReason;
} {
  const h = normalizeHandle(input);

  if (h.length < MIN_HANDLE_LEN) return { ok: false, normalized: h, reason: "TOO_SHORT" };
  if (h.length > MAX_HANDLE_LEN) return { ok: false, normalized: h, reason: "TOO_LONG" };
  if (!handlePattern.test(h)) return { ok: false, normalized: h, reason: "INVALID_FORMAT" };
  if (isReservedHandle(h)) return { ok: false, normalized: h, reason: "RESERVED" };

  return { ok: true, normalized: h };
}

export function assertValidHandle(input: string): string {
  const v = validateHandle(input);
  if (v.ok) return v.normalized;

  // One friendly message is enough for MVP.
  throw new Error(
    "Invalid handle. Use 3–32 lowercase letters/numbers separated by hyphens (e.g. 'saulo' or 'saulo-pt')."
  );
}

/**
 * Client-safe Zod schema for handles.
 * IMPORTANT: validation files import this to avoid duplicating handle rules.
 */
export const HandleSchema = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    return normalizeHandle(v);
  }, z.string())
  .superRefine((v, ctx) => {
    if (typeof v !== "string") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid handle" });
      return;
    }

    const res = validateHandle(v);
    if (res.ok) return;

    const msg =
      res.reason === "TOO_SHORT"
        ? "Handle is too short"
        : res.reason === "TOO_LONG"
          ? "Handle is too long"
          : res.reason === "RESERVED"
            ? "Handle is reserved"
            : "Invalid handle";

    ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
  });

export type HandleInput = z.infer<typeof HandleSchema>;
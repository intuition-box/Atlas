import { z } from "zod";

/**
 * NOTE: Our app uses stable IDs everywhere internally.
 * This is a light guard for IDs passed via APIs/forms.
 */
export const Id = z.string().trim().min(1);

// Back-compat alias (older code may still import `Cuid`).
export const Cuid = z.string().trim().min(10);

/**
 * User/community handles used for routes + display only.
 * - Accepts leading "@" in input.
 * - Normalizes to lowercase.
 */
export const Handle = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const trimmed = v.trim();
    const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    return withoutAt.trim().toLowerCase();
  },
  z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_-]+$/, "Invalid handle (use a-z, 0-9, underscore, hyphen)")
);

export const Url = z.string().trim().url();

/**
 * Optional URL where empty string maps to undefined.
 */
export const OptionalUrl = z.preprocess(
  (v) => {
    if (v === "") return undefined;
    if (typeof v === "string") return v.trim();
    return v;
  },
  z.string().url().optional()
);

export const NonEmptyString = z.string().trim().min(1);

/**
 * Parse JSON strings from form bodies into a typed schema.
 * If parsing fails, the downstream schema will fail validation.
 */
export function jsonOk<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    if (!s) return v;
    try {
      return JSON.parse(s);
    } catch {
      return v;
    }
  }, schema);
}
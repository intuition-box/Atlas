import { z } from "zod";

/**
 * Canonical validations
 *
 * This file merges the old `src/lib/validation/*` modules into a single client-safe
 * source of truth for Zod schemas and their inferred types.
 *
 * Goals:
 * - Shared primitives (Id, Url, OptionalUrl, etc.)
 * - No cross-module circular imports (HandleSchema lives here)
 * - Minimal magic: validate shapes, keep business logic elsewhere
 */

// -----------------------------------------------------------------------------
// Shared primitives
// -----------------------------------------------------------------------------

export const Id = z.string().trim().min(1, "Required");
export const NonEmptyString = z.string().trim().min(1, "Required");

export const Url = z.string().trim().url("Invalid URL");

/**
 * URL input that allows "" from forms (treated as undefined).
 */
export const OptionalUrl = z.preprocess(
  (v) => {
    if (v == null) return undefined;
    if (typeof v === "string") {
      const s = v.trim();
      return s.length === 0 ? undefined : s;
    }
    return v;
  },
  z.string().url("Invalid URL").optional(),
);

/**
 * Parse JSON when it arrives as a string (e.g. form fields).
 * If parsing fails, the schema will fail.
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

export type JsonInputValue =
  | null
  | boolean
  | number
  | string
  | JsonInputValue[]
  | { [k: string]: JsonInputValue };

export const JsonInputValueSchema: z.ZodType<JsonInputValue> = z.custom<JsonInputValue>((v) => {
  try {
    // Reject values that are not JSON-serializable (e.g. bigint, functions, symbols).
    return JSON.stringify(v) !== undefined;
  } catch {
    return false;
  }
}, "Invalid JSON value");

// -----------------------------------------------------------------------------
// Handle
// -----------------------------------------------------------------------------

/**
 * Handle input (for public routing / usernames).
 *
 * Keep this validation intentionally permissive; deeper rules like availability,
 * reserved words, cooldowns, etc. live in handle-registry.
 */
export const HandleSchema = z
  .string()
  .trim()
  .min(3, "Handle is too short")
  .max(32, "Handle is too long")
  .transform((s) => s.toLowerCase())
  .refine(
    (s) => /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(s),
    "Handle may contain letters, numbers, '.', '_' or '-' and must start/end with a letter or number",
  )
  .refine((s) => !s.includes(".."), "Handle cannot contain '..'")
  .refine((s) => !s.includes("--"), "Handle cannot contain '--'")
  .refine((s) => !s.includes("__"), "Handle cannot contain '__'");

export type HandleInput = z.infer<typeof HandleSchema>;

// -----------------------------------------------------------------------------
// Memberships
// -----------------------------------------------------------------------------
// Must match Prisma enum `MembershipStatus`.
// IMPORTANT: keep this list in sync with `enum MembershipStatus` in `prisma/schema.prisma`.
export const MembershipStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "BANNED",
]);

export const MembershipSubmitSchema = z.object({
  communityId: Id,
  answers: JsonInputValueSchema.default({}),
});

export const MembershipListSchema = z.object({
  communityId: Id,
  status: MembershipStatusSchema.optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});

export type MembershipSubmitInput = z.infer<typeof MembershipSubmitSchema>;
export type MembershipListInput = z.infer<typeof MembershipListSchema>;

// -----------------------------------------------------------------------------
// Attestations
// -----------------------------------------------------------------------------

// Must match Prisma enum for AttestationType.
// IMPORTANT: keep this list in sync with `enum AttestationType` in `prisma/schema.prisma`.
export const ATTESTATION_TYPES = [
  "LOVE",
  "REACH",
  "TRUST",
  "SKILL",
  "MENTOR",
  "COLLABORATOR",
  "FRIEND",
] as const;

export const AttestationTypeSchema = z.enum(ATTESTATION_TYPES);

export const AttestationCreateSchema = z.object({
  communityId: Id,
  fromUserId: Id,
  toUserId: Id,
  type: AttestationTypeSchema,
  note: z.string().trim().max(500).optional(),
});

export const AttestationRetractSchema = z.object({
  communityId: Id,
  fromUserId: Id,
  toUserId: Id,
  type: AttestationTypeSchema,
});

export const AttestationSupersedeSchema = z
  .object({
    communityId: Id,
    fromUserId: Id,
    toUserId: Id,
    type: AttestationTypeSchema,
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.note != null, { message: "Nothing to update" });

export const AttestationListSchema = z
  .object({
    communityId: Id.optional(),
    fromUserId: Id.optional(),
    toUserId: Id.optional(),
    type: AttestationTypeSchema.optional(),
    take: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((v) => v.communityId || v.fromUserId || v.toUserId || v.type, {
    message: "Provide at least one filter (communityId, fromUserId, toUserId, type)",
  });

export type AttestationType = z.infer<typeof AttestationTypeSchema>;
export type AttestationCreateInput = z.infer<typeof AttestationCreateSchema>;
export type AttestationRetractInput = z.infer<typeof AttestationRetractSchema>;
export type AttestationSupersedeInput = z.infer<typeof AttestationSupersedeSchema>;
export type AttestationListInput = z.infer<typeof AttestationListSchema>;

// -----------------------------------------------------------------------------
// Communities
// -----------------------------------------------------------------------------

export const CommunityCreateSchema = z.object({
  name: NonEmptyString.max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  avatarUrl: OptionalUrl.nullable().optional(),
  handle: HandleSchema,
  isMembershipOpen: z.coerce.boolean().optional(),
  isPublicDirectory: z.coerce.boolean().optional(),
  membershipConfig: jsonOk(z.unknown()).nullable().optional(),
  orbitConfig: jsonOk(z.unknown()).nullable().optional(),
});

export const CommunityUpdateSchema = z.object({
  communityId: Id,
  handle: HandleSchema.optional(),
  name: NonEmptyString.max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  avatarUrl: OptionalUrl.nullable().optional(),
  isMembershipOpen: z.coerce.boolean().optional(),
  isPublicDirectory: z.coerce.boolean().optional(),
  membershipConfig: jsonOk(z.unknown()).nullable().optional(),
  orbitConfig: jsonOk(z.unknown()).nullable().optional(),
});

export const CommunityGetSchema = z
  .object({
    communityId: Id.optional(),
    handle: HandleSchema.optional(),
  })
  .refine((v) => v.communityId || v.handle, {
    message: "Provide communityId or handle",
  });

export const CommunityListSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).optional(),
});

export type CommunityCreateInput = z.infer<typeof CommunityCreateSchema>;
export type CommunityUpdateInput = z.infer<typeof CommunityUpdateSchema>;
export type CommunityGetInput = z.infer<typeof CommunityGetSchema>;
export type CommunityListInput = z.infer<typeof CommunityListSchema>;

// -----------------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------------

const Skill = z.string().trim().min(1).max(32);
const Tag = z.string().trim().min(1).max(32);

export const UserLinksSchema = z.array(Url).max(10);
export const UserSkillsSchema = z.array(Skill).max(32);
export const UserTagsSchema = z.array(Tag).max(32);

export const UserGetQuerySchema = z
  .object({
    userId: Id.optional(),
    handle: HandleSchema.optional(),
  })
  .refine((v) => v.userId || v.handle, {
    message: "Provide userId or handle",
  });

export const UserUpdateSchema = z.object({
  userId: Id,
  name: z.string().trim().max(80).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  avatarUrl: OptionalUrl.nullable().optional(),
  links: UserLinksSchema.nullable().optional(),
  skills: UserSkillsSchema.nullable().optional(),
  tags: UserTagsSchema.nullable().optional(),
});

export const ProfileOnboardingSchema = UserUpdateSchema.extend({
  handle: HandleSchema,
});

export type UserGetQueryInput = z.infer<typeof UserGetQuerySchema>;
export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;
export type ProfileOnboardingInput = z.infer<typeof ProfileOnboardingSchema>;
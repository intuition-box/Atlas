import { z } from "zod";

const Id = z.string().trim().min(1);

// Client-safe source of truth for allowed attestation types.
// IMPORTANT: keep this list in sync with `enum AttestationType` in `prisma/schema.prisma`.
export const ATTESTATION_TYPES = [
  "WORKED_TOGETHER",
  "KNOWS_IRL",
  "ROLE_DEV",
  "ROLE_ARTIST",
  "ROLE_DESIGN",
  "OTHER",
] as const;

export const AttestationTypeSchema = z.enum(ATTESTATION_TYPES);

export const AttestationCreateSchema = z.object({
  communityId: Id,
  toUserId: Id,
  type: AttestationTypeSchema,
  note: z.string().trim().max(500).optional().nullable(),
  confidence: z.coerce.number().min(0).max(1).optional().nullable(),
});

export const AttestationRetractSchema = z.object({
  attestationId: Id,
  reason: z.string().trim().max(500).optional(),
});

export const AttestationSupersedeSchema = z
  .object({
    attestationId: Id,
    note: z.string().trim().max(500).nullable().optional(),
    confidence: z.coerce.number().min(0).max(1).nullable().optional(),
  })
  .refine((v) => v.note !== undefined || v.confidence !== undefined, "Nothing to update");

export const AttestationListSchema = z
  .object({
    communityId: Id.optional(),
    toUserId: Id.optional(), // list attestations about this user
    fromUserId: Id.optional(),
    take: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine(
    (v) => Boolean(v.communityId || v.toUserId || v.fromUserId),
    "Provide at least one filter: communityId, toUserId, or fromUserId",
  );

export type AttestationCreateInput = z.infer<typeof AttestationCreateSchema>;
export type AttestationRetractInput = z.infer<typeof AttestationRetractSchema>;
export type AttestationSupersedeInput = z.infer<typeof AttestationSupersedeSchema>;
export type AttestationListInput = z.infer<typeof AttestationListSchema>;
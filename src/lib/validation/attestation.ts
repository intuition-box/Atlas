import { z } from "zod";

export const AttestationTypeSchema = z.enum([
  "WORKED_TOGETHER",
  "KNOWS_IRL",
  "ROLE_DEV",
  "ROLE_ARTIST",
  "ROLE_DESIGN",
  "OTHER",
]);

export const AttestationCreateSchema = z.object({
  communityId: z.string().trim().min(1),
  toUserId: z.string().trim().min(1),
  type: AttestationTypeSchema,
  note: z.string().trim().max(500).optional().nullable(),
  confidence: z.coerce.number().min(0).max(1).optional().nullable(),
});

export const AttestationListSchema = z
  .object({
    communityId: z.string().trim().min(1).optional(),
    userId: z.string().trim().min(1).optional(), // list attestations about this user
    fromUserId: z.string().trim().min(1).optional(),
    take: z.coerce.number().int().min(1).max(200).optional(),
  })
  .refine(
    (v) => Boolean(v.communityId || v.userId || v.fromUserId),
    "Provide at least one filter: communityId, userId, or fromUserId"
  );
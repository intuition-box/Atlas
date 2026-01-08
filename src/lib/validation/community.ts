import { z } from "zod";

import { Id, NonEmptyString, OptionalUrl, jsonOk } from "./common";
import { HandleSchema } from "@/lib/handle";

export const CommunityCreateSchema = z.object({
  name: NonEmptyString.max(80),
  handle: HandleSchema,
  description: z.string().trim().max(500).optional().nullable(),
  avatarUrl: OptionalUrl.optional().nullable(),
  isPublicDirectory: z.coerce.boolean().optional(),
});

export const CommunityUpdateSchema = z.object({
  communityId: Id,
  name: NonEmptyString.max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  avatarUrl: OptionalUrl.optional().nullable(),
  isPublicDirectory: z.coerce.boolean().optional(),
  // keep as Json in DB; validate shape later when you implement schema builder UI
  applicationFormSchema: jsonOk(z.unknown()).optional().nullable(),
  orbitConfig: jsonOk(z.unknown()).optional().nullable(),
});

export const CommunityGetSchema = z
  .object({
    handle: HandleSchema.optional(),
    communityId: Id.optional(),
  })
  .refine((v) => Boolean(v.handle || v.communityId), "Provide handle or communityId");

export const CommunityListSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).optional(),
  includePrivate: z.coerce.boolean().optional(),
});
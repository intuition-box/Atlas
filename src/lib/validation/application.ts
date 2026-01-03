import { z } from "zod";

export const ApplicationStatusSchema = z.enum(["SUBMITTED", "APPROVED", "REJECTED"]);

export const ApplicationSubmitSchema = z.object({
  communityId: z.string().trim().min(1),
  // MVP: answers is arbitrary JSON (validated per-community later)
  answers: z.record(z.unknown()).default({}),
});

export const ApplicationListSchema = z.object({
  communityId: z.string().trim().min(1),
  status: ApplicationStatusSchema.optional(),
  // Query params often arrive as strings.
  take: z.coerce.number().int().min(1).max(100).optional(),
});
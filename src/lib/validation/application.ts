import { z } from "zod";

const Id = z.string().trim().min(1);

// Client-safe JSON input type (structurally compatible with Prisma's JSON input).
export type JsonInputValue =
  | null
  | boolean
  | number
  | string
  | JsonInputValue[]
  | { [key: string]: JsonInputValue };

const JsonInputValueSchema: z.ZodType<JsonInputValue> = z.custom<JsonInputValue>(
  (v) => {
    try {
      JSON.stringify(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid JSON value" },
);

// IMPORTANT: keep in sync with the Prisma enum for application status.
export const ApplicationStatusSchema = z.enum(["SUBMITTED", "APPROVED", "REJECTED"]);

export const ApplicationSubmitSchema = z.object({
  communityId: Id,
  // MVP: answers is arbitrary JSON (validated per-community later)
  answers: JsonInputValueSchema.default({} as JsonInputValue),
});

export const ApplicationListSchema = z.object({
  communityId: Id,
  status: ApplicationStatusSchema.optional(),
  // Query params often arrive as strings.
  take: z.coerce.number().int().min(1).max(100).optional(),
});
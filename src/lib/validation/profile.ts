import { z } from "zod";

import { NonEmptyString, OptionalUrl, Url } from "./common";
import { HandleSchema } from "@/lib/handle";

const Skill = z.string().trim().min(1).max(32);
const Tag = z.string().trim().min(1).max(32);

export const ProfileLinksSchema = z.array(Url).max(10);
export const ProfileSkillsSchema = z.array(Skill).max(32);
export const ProfileTagsSchema = z.array(Tag).max(32);

/**
 * Used for onboarding and account settings.
 * NOTE: handle changes may be managed via the handle system separately;
 * include `handle` only when you explicitly want to capture it.
 */
export const ProfileUpdateSchema = z.object({
  name: NonEmptyString.max(80).optional().nullable(),
  avatarUrl: OptionalUrl.optional().nullable(),
  headline: z.string().trim().max(120).optional().nullable(),
  bio: z.string().trim().max(2000).optional().nullable(),
  location: z.string().trim().max(80).optional().nullable(),
  links: ProfileLinksSchema.optional(),
  skills: ProfileSkillsSchema.optional(),
  tags: ProfileTagsSchema.optional(),
});

/**
 * Optional onboarding contract if you want to require a handle at signup.
 * If you don't want handles during onboarding yet, you can ignore this.
 */
export const ProfileOnboardingSchema = ProfileUpdateSchema.extend({
  handle: HandleSchema,
});
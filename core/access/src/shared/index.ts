import { z } from "zod";

/** A user's login name: lower case after trimming, letters, digits, `.`, `_`, `-`. */
export const loginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,64}$/, "a login is 3–64 letters, digits, dots, dashes, or underscores");

/** Length only: no composition rules, and a ceiling so hashing stays bounded. */
export const passwordSchema = z.string().min(10).max(256);

export const userNameSchema = z.string().trim().min(1).max(200);

export const newOwnerSchema = z.object({
  name: userNameSchema,
  login: loginSchema,
});

export type NewOwnerInput = z.input<typeof newOwnerSchema>;

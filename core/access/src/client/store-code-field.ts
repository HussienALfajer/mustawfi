import { storeCodeSchema } from "@mustawfi/core-tenancy/shared";
import { z } from "zod";

/**
 * A store code as a form holds it: required, and of a store code's shape (ADR-0029), which is
 * public, so a mistyped one is said on its field before any request (QA slice 22). The issue
 * messages are the message keys `required` and `storeCodeShape` of the form's namespace.
 */
export const storeCodeFieldSchema = z
  .string()
  .trim()
  .min(1, "required")
  .refine((code) => storeCodeSchema.safeParse(code).success, "storeCodeShape");

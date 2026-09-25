import { z } from "zod";

/**
 * The code of a document type in its numbers (`INV` in `K7-INV-000123`, ADR-0020): three
 * upper-case Latin letters, declared by the module that owns the document type and unique
 * across modules (`core-foundation` rule 30).
 */
export const documentCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "a document code is three upper-case letters");

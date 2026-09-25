import { z } from "zod";

/** An ISO 4217 code (`SYP`, `USD`); which codes a tenant may use is `core.currency`'s concern. */
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "a currency is an ISO 4217 code");

export const tenantNameSchema = z.string().trim().min(1).max(200);

/** What it takes to create a tenant; ids and audit fields come from the caller. */
export const newTenantSchema = z.object({
  name: tenantNameSchema,
  baseCurrency: currencyCodeSchema,
});

export type NewTenantInput = z.infer<typeof newTenantSchema>;

/** The length of a store code (ADR-0029): 32^6 ≈ 1.07 × 10⁹ codes. */
export const STORE_CODE_LENGTH = 6;

/**
 * A store code as people type it: case, spaces, and dashes are forgiven, so `k7m-3qx` is
 * `K7M3QX`. Six symbols without `I`, `O`, `0`, or `1` (ADR-0029).
 */
export const storeCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/, "a store code is six letters and digits"));

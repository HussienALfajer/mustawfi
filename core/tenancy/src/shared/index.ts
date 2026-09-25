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

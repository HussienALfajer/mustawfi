import { sql } from "drizzle-orm";
import { check, numeric, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * `inventory` tables (ADR-0016). Internal to the module: no entry exports them. Products are
 * master data: never deleted (archiving comes with product editing).
 */
export const inventory = pgSchema("inventory");

export const products = inventory.table(
  "products",
  {
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0001_inventory_rls.sql`). */
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    name: text().notNull(),
    /** Unique within the tenant; several barcodes per product come with the `inventory` unit. */
    barcode: text(),
    /** Retail unit price, in `priceCurrency` (ADR-0018 unit-price scale). */
    price: numeric({ precision: 20, scale: 6 }).notNull(),
    priceCurrency: text().notNull(),
  },
  (t) => [
    unique("products_barcode_per_tenant").on(t.tenantId, t.barcode),
    check("products_price_not_negative", sql`${t.price} >= 0`),
    check("products_price_currency", sql`${t.priceCurrency} ~ '^[A-Z]{3}$'`),
  ],
);

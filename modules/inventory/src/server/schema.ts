import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

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
    // Target of tenant-scoped foreign keys: stock rows and invoice lines name their own
    // tenant's product, which a plain foreign key would not ensure (it bypasses RLS).
    unique("products_id_per_tenant").on(t.tenantId, t.id),
    check("products_price_not_negative", sql`${t.price} >= 0`),
    check("products_price_currency", sql`${t.priceCurrency} ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * Stock on hand per product (the default branch's only stock location until multi-branch).
 * Derived from `stock_movements` and kept in the same transaction; it may go negative
 * through offline sales, which are flagged, never refused (ADR-0005).
 */
export const stockLevels = inventory.table(
  "stock_levels",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    productId: uuid().notNull(),
    onHand: numeric({ precision: 20, scale: 4 }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique("stock_levels_product_per_tenant").on(t.tenantId, t.productId),
    foreignKey({
      name: "stock_levels_product_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
  ],
);

/** Every change of stock on hand, with the document behind it; never changed or deleted. */
export const stockMovements = inventory.table(
  "stock_movements",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    productId: uuid().notNull(),
    /** Signed: a sale is negative. */
    quantity: numeric({ precision: 20, scale: 4 }).notNull(),
    /** The document that moved the stock (`sales.invoice` and its id). */
    sourceType: text().notNull(),
    sourceId: uuid().notNull(),
  },
  (t) => [
    foreignKey({
      name: "stock_movements_product_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
    check("stock_movements_quantity_not_zero", sql`${t.quantity} <> 0`),
    check(
      "stock_movements_source_type",
      sql`${t.sourceType} ~ '^[a-z][a-zA-Z0-9]*(\\.[a-z][a-zA-Z0-9]*)+$'`,
    ),
  ],
);

import type { PullApplier } from "@mustawfi/core-sync/client";
import { Decimal } from "@mustawfi/kernel";
import {
  int64,
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
} from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { asc, eq, inArray } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { PRODUCT_ENTITY, productSchema, type ProductView } from "../shared/index.ts";

/** Unit prices keep six decimals (`numeric(20,6)`, ADR-0018); stored scaled by 10^6. */
const PRICE_SCALE = 6;

/**
 * Products as the server last sent them (server-authoritative master data, ADR-0005): what the
 * POS sells from while offline.
 */
const localProducts = sqliteTable("inventory_products", {
  id: text().primaryKey(),
  name: text().notNull(),
  barcode: text(),
  priceScaled: int64("price_scaled").notNull(),
  priceCurrency: text("price_currency").notNull(),
  createdAt: text("created_at").notNull(),
});

export const LOCAL_PRODUCTS_TABLE = "inventory_products";

/** `inventory`'s local schema (ADR-0019). */
export const inventoryLocalMigrations: readonly LocalMigration[] = [
  {
    id: "inventory.0001_products",
    statements: [
      `CREATE TABLE inventory_products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        barcode TEXT UNIQUE,
        price_scaled INTEGER NOT NULL CHECK (price_scaled >= 0),
        price_currency TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
];

type LocalProductRow = typeof localProducts.$inferSelect;

function toView(row: LocalProductRow): ProductView {
  return {
    id: row.id,
    name: row.name,
    barcode: row.barcode,
    price: {
      amount: Decimal.fromScaledInteger(row.priceScaled, PRICE_SCALE).toString(),
      currency: row.priceCurrency,
    },
    createdAt: row.createdAt,
  };
}

/** Applies pulled `inventory.product` changes: the full row, or a tombstone. */
export const productPullApplier: PullApplier = {
  entity: PRODUCT_ENTITY,
  async apply(tx, change) {
    const orm = localOrm(tx);
    if (change.row === null) {
      await orm.delete(localProducts).where(eq(localProducts.id, change.id));
      return;
    }
    const product = productSchema.parse(change.row);
    const row = {
      name: product.name,
      barcode: product.barcode,
      priceScaled: Decimal.of(product.price.amount).toScaledInteger(PRICE_SCALE),
      priceCurrency: product.price.currency,
      createdAt: product.createdAt,
    };
    await orm
      .insert(localProducts)
      .values({ id: product.id, ...row })
      .onConflictDoUpdate({ target: localProducts.id, set: row });
  },
};

/** The pull appliers of `inventory`, for the app's sync engine. */
export const inventoryPullAppliers: readonly PullApplier[] = [productPullApplier];

/** Every product on this device, by name. */
export async function listLocalProducts(executor: LocalExecutor): Promise<ProductView[]> {
  const rows = await localOrm(executor)
    .select()
    .from(localProducts)
    .orderBy(asc(localProducts.name), asc(localProducts.id));
  return rows.map(toView);
}

/** The products with these ids that this device has. */
export async function localProductsById(
  executor: LocalExecutor,
  ids: readonly string[],
): Promise<Map<string, ProductView>> {
  if (ids.length === 0) return new Map();
  const rows = await localOrm(executor)
    .select()
    .from(localProducts)
    .where(inArray(localProducts.id, [...ids]));
  return new Map(rows.map((row) => [row.id, toView(row)]));
}

/** The product a scanned barcode names on this device. */
export async function localProductByBarcode(
  executor: LocalExecutor,
  barcode: string,
): Promise<ProductView | undefined> {
  const row = await localOrm(executor)
    .select()
    .from(localProducts)
    .where(eq(localProducts.barcode, barcode))
    .get();
  return row === undefined ? undefined : toView(row);
}

export const localProductsQueryKey = ["local", "inventory", "products"] as const;

export function localProductsQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: localProductsQueryKey,
    queryFn: () => listLocalProducts(db),
    networkMode: "always",
    meta: { localTables: [LOCAL_PRODUCTS_TABLE] },
  });
}

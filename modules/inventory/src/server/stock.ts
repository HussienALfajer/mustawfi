import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { Decimal, type IdGenerator } from "@mustawfi/kernel";
import { inArray, sql } from "drizzle-orm";
import { products, stockLevels, stockMovements } from "./schema.ts";

/** Quantities are `numeric(20,4)` (ADR-0018). */
const QUANTITY_SCALE = 4;

export interface StockMovementBatch {
  /** Must be the tenant of the `withTenant` context `tx` runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  /** The document that moves the stock: `sales.invoice` and its id. */
  readonly source: { readonly type: string; readonly id: string };
  /** Signed quantities (a sale is negative), in the product's stock unit. */
  readonly movements: readonly { readonly productId: string; readonly quantity: Decimal }[];
}

export interface StockLevel {
  readonly productId: string;
  /** After the movement; below zero when more was sold than was on hand. */
  readonly onHand: Decimal;
}

/** The ids among `productIds` that name products of the current tenant. */
export async function knownProducts(
  tx: TenantTransaction,
  productIds: readonly string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, [...new Set(productIds)]));
  return new Set(rows.map((row) => row.id));
}

/**
 * Records stock movements for one document in `tx`, the document's transaction, and returns
 * each product's stock on hand after them. Stock may go negative: offline sales are never
 * refused for it (ADR-0005); the caller flags it. Levels are updated in product-id order, so
 * two documents moving the same products cannot deadlock. An unknown product fails on the
 * tenant-scoped foreign key; check with `knownProducts` first.
 */
export async function moveStock(
  tx: TenantTransaction,
  batch: StockMovementBatch,
  dependencies: { readonly newId: IdGenerator },
): Promise<StockLevel[]> {
  const totals = new Map<string, Decimal>();
  for (const { productId, quantity } of batch.movements) {
    if (quantity.isZero() || quantity.scale() > QUANTITY_SCALE) {
      throw new TypeError(
        `a stock movement is non-zero with at most ${String(QUANTITY_SCALE)} decimals`,
      );
    }
    totals.set(productId, (totals.get(productId) ?? Decimal.ZERO).plus(quantity));
  }
  const audit = {
    tenantId: batch.tenantId,
    branchId: batch.branchId,
    createdAt: batch.createdAt,
    createdBy: batch.createdBy,
  };
  if (batch.movements.length > 0) {
    await tx.insert(stockMovements).values(
      batch.movements.map(({ productId, quantity }) => ({
        ...audit,
        id: dependencies.newId(),
        productId,
        quantity: quantity.toString(),
        sourceType: batch.source.type,
        sourceId: batch.source.id,
      })),
    );
  }

  const levels: StockLevel[] = [];
  for (const productId of [...totals.keys()].sort()) {
    const quantity = totals.get(productId) ?? Decimal.ZERO;
    const [level] = await tx
      .insert(stockLevels)
      .values({
        ...audit,
        id: dependencies.newId(),
        productId,
        onHand: quantity.toString(),
        updatedAt: batch.createdAt,
      })
      .onConflictDoUpdate({
        target: [stockLevels.tenantId, stockLevels.productId],
        set: {
          onHand: sql`${sql.identifier("stock_levels")}.on_hand + excluded.on_hand`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning({ onHand: stockLevels.onHand });
    if (level === undefined) throw new Error("the stock level upsert returned no row");
    levels.push({ productId, onHand: Decimal.of(level.onHand) });
  }
  return levels;
}

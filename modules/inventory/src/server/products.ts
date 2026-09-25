import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import { recordChange } from "@mustawfi/core-sync/server";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { Decimal, type IdGenerator } from "@mustawfi/kernel";
import { asc, gt } from "drizzle-orm";
import {
  inventoryProblemCodes,
  newProductSchema,
  PRODUCT_ENTITY,
  PRODUCT_PAGE_LIMIT,
  type NewProductInput,
  type ProductView,
} from "../shared/index.ts";
import { products } from "./schema.ts";

export interface NewProduct extends NewProductInput {
  readonly id: string;
  /** Must be the tenant of the `withTenant` context `tx` runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly deviceId?: string;
}

type ProductRow = typeof products.$inferSelect;

/** A stored price in its shortest canonical form (`"1250.500000"` → `"1250.5"`). */
function toView(row: ProductRow): ProductView {
  return {
    id: row.id,
    name: row.name,
    barcode: row.barcode,
    price: { amount: Decimal.of(row.price).toString(), currency: row.priceCurrency },
    createdAt: row.createdAt.toISOString(),
  };
}

/** Whether `error` is a unique violation of `constraint`, through the driver's wrapping. */
function violates(error: unknown, constraint: string): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    const fields = e as { code?: unknown; constraint?: unknown };
    if (fields.code === "23505") return fields.constraint === constraint;
  }
  return false;
}

/**
 * Creates a product in `tx`, audits it, and appends it to the change log devices pull from
 * (ADR-0020), all in the same transaction. A barcode another of the tenant's products has is
 * refused with a 409 `inventory.product.barcodeTaken`.
 */
export async function createProduct(
  tx: TenantTransaction,
  product: NewProduct,
  dependencies: { readonly newId: IdGenerator },
): Promise<ProductView> {
  const { name, barcode, price } = newProductSchema.parse(product);
  const values = {
    id: product.id,
    tenantId: product.tenantId,
    branchId: product.branchId,
    createdAt: product.createdAt,
    createdBy: product.createdBy,
    name,
    barcode: barcode ?? null,
    price: price.amount,
    priceCurrency: price.currency,
  };
  let row: ProductRow | undefined;
  try {
    [row] = await tx.insert(products).values(values).returning();
  } catch (error) {
    if (!violates(error, "products_barcode_per_tenant")) throw error;
    throw new ProblemError(inventoryProblemCodes.barcodeTaken, 409, {
      title: "Another product has this barcode",
      cause: error,
    });
  }
  if (row === undefined) throw new Error("the product insert returned no row");
  const view = toView(row);
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: product.tenantId,
    branchId: product.branchId,
    occurredAt: product.createdAt,
    userId: product.createdBy,
    ...(product.deviceId === undefined ? {} : { deviceId: product.deviceId }),
    action: "inventory.product.created",
    entity: { type: "inventory.product", id: view.id },
    after: { name: view.name, barcode: view.barcode, price: view.price },
  });
  await recordChange(
    tx,
    {
      tenantId: product.tenantId,
      branchId: product.branchId,
      createdAt: product.createdAt,
      createdBy: product.createdBy,
      entity: PRODUCT_ENTITY,
      entityId: view.id,
      row: view,
    },
    dependencies,
  );
  return view;
}

/** A page of the current tenant's products in creation order, after the id `after`. */
export async function listProducts(
  tx: TenantTransaction,
  page: { readonly limit?: number; readonly after?: string | undefined } = {},
): Promise<{ items: ProductView[]; next: string | null }> {
  const limit = page.limit ?? PRODUCT_PAGE_LIMIT;
  const rows = await tx
    .select()
    .from(products)
    .where(page.after === undefined ? undefined : gt(products.id, page.after))
    .orderBy(asc(products.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(toView);
  return { items, next: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}

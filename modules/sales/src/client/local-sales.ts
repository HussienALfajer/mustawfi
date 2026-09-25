import type { LocalDevice } from "@mustawfi/core-access/client";
import {
  enqueueOperation,
  nextDocumentSeq,
  OUTBOX_TABLE,
  type OutboxState,
  operationStates,
} from "@mustawfi/core-sync/client";
import { LOCAL_PRODUCTS_TABLE, localProductsById, priceCurrency } from "@mustawfi/inventory/client";
import { DEFAULT_TIME_ZONE } from "@mustawfi/i18n";
import { type Clock, type Currency, Decimal, type IdGenerator, Money } from "@mustawfi/kernel";
import {
  int64,
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
  safeInteger,
} from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { asc, desc, eq, sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  formatInvoiceNumber,
  INVOICE_DOC_CODE,
  INVOICE_POST_OPERATION,
  type InvoicePostPayloadV1,
  SKELETON_DOCUMENT_DEFAULTS,
} from "../shared/index.ts";

/** Scales of the local scaled integers, as their server columns (ADR-0018). */
const QUANTITY_SCALE = 4;
const PRICE_SCALE = 6;
const AMOUNT_SCALE = 4;
const RATE_SCALE = 6;

/**
 * The store's time zone, which sets an invoice's business date (ADR-0020: the device's day):
 * the default of ADR-0023 until the tenant's time zone is a setting.
 */
export const BUSINESS_TIME_ZONE = DEFAULT_TIME_ZONE;

/** The POS cart (ADR-0023): written on every change, so it survives a closed tab or a power cut. */
const cartLines = sqliteTable("sales_cart_lines", {
  productId: text("product_id").primaryKey(),
  quantityScaled: int64("quantity_scaled").notNull(),
  position: safeInteger().notNull(),
});

/** The invoices this device made, as it recorded and pushed them. */
export const localInvoices = sqliteTable("sales_invoices", {
  id: text().primaryKey(),
  number: text().notNull(),
  docSeq: safeInteger("doc_seq").notNull(),
  opId: text("op_id").notNull(),
  businessDate: text("business_date").notNull(),
  soldAt: text("sold_at").notNull(),
  userId: text("user_id").notNull(),
  currency: text().notNull(),
  exchangeRateScaled: int64("exchange_rate_scaled").notNull(),
  departmentId: text("department_id").notNull(),
  shiftId: text("shift_id").notNull(),
  templateVersion: text("template_version").notNull(),
  totalScaled: int64("total_scaled").notNull(),
});

export const localInvoiceLines = sqliteTable("sales_invoice_lines", {
  id: text().primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  lineNo: safeInteger("line_no").notNull(),
  productId: text("product_id").notNull(),
  /** The name when sold, for the receipt and the list. */
  productName: text("product_name").notNull(),
  quantityScaled: int64("quantity_scaled").notNull(),
  unitPriceScaled: int64("unit_price_scaled").notNull(),
  amountScaled: int64("amount_scaled").notNull(),
});

export const CART_TABLE = "sales_cart_lines";
export const LOCAL_INVOICES_TABLE = "sales_invoices";

/** `sales`' local schema (ADR-0019). */
export const salesLocalMigrations: readonly LocalMigration[] = [
  {
    id: "sales.0001_cart_and_invoices",
    statements: [
      `CREATE TABLE sales_cart_lines (
        product_id TEXT PRIMARY KEY,
        quantity_scaled INTEGER NOT NULL CHECK (quantity_scaled > 0),
        position INTEGER NOT NULL
      ) STRICT`,
      `CREATE TABLE sales_invoices (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        doc_seq INTEGER NOT NULL UNIQUE CHECK (doc_seq > 0),
        op_id TEXT NOT NULL UNIQUE,
        business_date TEXT NOT NULL,
        sold_at TEXT NOT NULL,
        user_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        exchange_rate_scaled INTEGER NOT NULL CHECK (exchange_rate_scaled > 0),
        department_id TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        template_version TEXT NOT NULL,
        total_scaled INTEGER NOT NULL CHECK (total_scaled >= 0)
      ) STRICT`,
      `CREATE TABLE sales_invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES sales_invoices (id),
        line_no INTEGER NOT NULL CHECK (line_no > 0),
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity_scaled INTEGER NOT NULL CHECK (quantity_scaled > 0),
        unit_price_scaled INTEGER NOT NULL CHECK (unit_price_scaled >= 0),
        amount_scaled INTEGER NOT NULL CHECK (amount_scaled >= 0),
        UNIQUE (invoice_id, line_no)
      ) STRICT`,
      // A recorded invoice is a posted document (non-negotiable 6): never changed or removed.
      `CREATE TRIGGER sales_invoices_immutable BEFORE UPDATE ON sales_invoices
        BEGIN SELECT RAISE(ABORT, 'a recorded invoice cannot change'); END`,
      `CREATE TRIGGER sales_invoices_kept BEFORE DELETE ON sales_invoices
        BEGIN SELECT RAISE(ABORT, 'a recorded invoice cannot be deleted'); END`,
      `CREATE TRIGGER sales_invoice_lines_immutable BEFORE UPDATE ON sales_invoice_lines
        BEGIN SELECT RAISE(ABORT, 'a recorded invoice line cannot change'); END`,
      `CREATE TRIGGER sales_invoice_lines_kept BEFORE DELETE ON sales_invoice_lines
        BEGIN SELECT RAISE(ABORT, 'a recorded invoice line cannot be deleted'); END`,
    ],
  },
];

const ONE = Decimal.ONE.toScaledInteger(QUANTITY_SCALE);

/** Adds one of a product to the cart, or one more of it. */
export async function addToCart(db: LocalDb, productId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const orm = localOrm(tx);
    const [last] = await orm
      .select({
        position: sql`coalesce(max(${cartLines.position}), 0)`.mapWith(cartLines.position),
      })
      .from(cartLines);
    await orm
      .insert(cartLines)
      .values({ productId, quantityScaled: ONE, position: (last?.position ?? 0) + 1 })
      .onConflictDoUpdate({
        target: cartLines.productId,
        set: { quantityScaled: sql`${cartLines.quantityScaled} + ${ONE}` },
      });
  });
}

export async function removeFromCart(db: LocalDb, productId: string): Promise<void> {
  await localOrm(db).delete(cartLines).where(eq(cartLines.productId, productId));
}

export interface CartLine {
  readonly productId: string;
  /** `undefined` when the product is no longer on this device. */
  readonly name: string | undefined;
  readonly quantity: Decimal;
  readonly unitPrice: Money | undefined;
  /** Unit price × quantity, rounded half away from zero to the minor unit (ADR-0018). */
  readonly amount: Money | undefined;
  /** Sold in the device's currency: `false` for a product priced in another currency. */
  readonly sellable: boolean;
}

export interface Cart {
  readonly currency: Currency;
  readonly lines: readonly CartLine[];
  /** The sum of the sellable lines. */
  readonly total: Money;
  /** Every line can be sold, and there is at least one. */
  readonly ready: boolean;
}

/** The cart as the POS shows it and the sale records it. */
export async function readCart(executor: LocalExecutor, baseCurrency: string): Promise<Cart> {
  const currency = priceCurrency(baseCurrency);
  const rows = await localOrm(executor).select().from(cartLines).orderBy(asc(cartLines.position));
  const products = await localProductsById(
    executor,
    rows.map((row) => row.productId),
  );
  const lines = rows.map((row): CartLine => {
    const product = products.get(row.productId);
    const quantity = Decimal.fromScaledInteger(row.quantityScaled, QUANTITY_SCALE);
    if (product === undefined) {
      return {
        productId: row.productId,
        name: undefined,
        quantity,
        unitPrice: undefined,
        amount: undefined,
        sellable: false,
      };
    }
    const unitPrice = Money.of(product.price.amount, priceCurrency(product.price.currency));
    const sellable = product.price.currency === currency.code;
    return {
      productId: row.productId,
      name: product.name,
      quantity,
      unitPrice,
      amount: unitPrice.times(quantity).roundToMinorUnit("halfAwayFromZero"),
      sellable,
    };
  });
  const sold = lines.flatMap((line) =>
    line.sellable && line.amount !== undefined ? [line.amount] : [],
  );
  return {
    currency,
    lines,
    total: Money.sum(sold, currency),
    ready: lines.length > 0 && lines.every((line) => line.sellable),
  };
}

/** The cart cannot become a sale: it is empty, or a line cannot be sold on this device. */
export class SaleRefused extends Error {
  override name = "SaleRefused";
  readonly reason: "emptyCart" | "notSellable";

  constructor(reason: "emptyCart" | "notSellable") {
    super(reason);
    this.reason = reason;
  }
}

export interface CashSaleInput {
  readonly device: LocalDevice;
  /** The signed-in user who sells. */
  readonly userId: string;
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

export interface RecordedSale {
  readonly invoiceId: string;
  readonly number: string;
  readonly total: Money;
}

/** `YYYY-MM-DD` of `instant` in `timeZone`. */
export function businessDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Sells the cart for cash, offline or not (flow 5): the invoice, its number
 * `{prefix}-INV-{seq:6}`, its outbox entry, and the emptied cart commit in one local
 * transaction (ADR-0019), or nothing does. The network is never touched.
 */
export async function completeCashSale(db: LocalDb, input: CashSaleInput): Promise<RecordedSale> {
  const { device, clock, newId } = input;
  return db.transaction(async (tx) => {
    const cart = await readCart(tx, device.baseCurrency);
    if (cart.lines.length === 0) throw new SaleRefused("emptyCart");
    if (!cart.ready) throw new SaleRefused("notSellable");

    const soldAt = clock.now();
    const seq = await nextDocumentSeq(tx, INVOICE_DOC_CODE);
    const number = formatInvoiceNumber(device.prefix, seq);
    const invoiceId = newId();
    const opId = newId();
    const exchangeRate = Decimal.ONE;
    const lines = cart.lines.map((line, index) => {
      if (line.unitPrice === undefined || line.amount === undefined || line.name === undefined) {
        throw new SaleRefused("notSellable");
      }
      return {
        id: newId(),
        lineNo: index + 1,
        productId: line.productId,
        productName: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
      };
    });
    const payload: InvoicePostPayloadV1 = {
      id: invoiceId,
      number,
      businessDate: businessDate(soldAt, BUSINESS_TIME_ZONE),
      currency: cart.currency.code,
      exchangeRate: exchangeRate.toString(),
      departmentId: SKELETON_DOCUMENT_DEFAULTS.departmentId,
      templateVersion: SKELETON_DOCUMENT_DEFAULTS.templateVersion,
      total: cart.total.amount.toString(),
      lines: lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.amount.toString(),
        amount: line.amount.amount.toString(),
      })),
    };

    const orm = localOrm(tx);
    await orm.insert(localInvoices).values({
      id: invoiceId,
      number,
      docSeq: seq,
      opId,
      businessDate: payload.businessDate,
      soldAt: soldAt.toISOString(),
      userId: input.userId,
      currency: payload.currency,
      exchangeRateScaled: exchangeRate.toScaledInteger(RATE_SCALE),
      departmentId: payload.departmentId,
      shiftId: SKELETON_DOCUMENT_DEFAULTS.shiftId,
      templateVersion: payload.templateVersion,
      totalScaled: cart.total.amount.toScaledInteger(AMOUNT_SCALE),
    });
    await orm.insert(localInvoiceLines).values(
      lines.map((line) => ({
        id: line.id,
        invoiceId,
        lineNo: line.lineNo,
        productId: line.productId,
        productName: line.productName,
        quantityScaled: line.quantity.toScaledInteger(QUANTITY_SCALE),
        unitPriceScaled: line.unitPrice.amount.toScaledInteger(PRICE_SCALE),
        amountScaled: line.amount.amount.toScaledInteger(AMOUNT_SCALE),
      })),
    );
    await enqueueOperation(tx, {
      opId,
      deviceId: device.deviceId,
      type: INVOICE_POST_OPERATION,
      payloadVersion: 1,
      payload,
      userId: input.userId,
      shiftId: SKELETON_DOCUMENT_DEFAULTS.shiftId,
      createdAt: soldAt,
    });
    await orm.delete(cartLines);
    return { invoiceId, number, total: cart.total };
  });
}

export interface LocalInvoice {
  readonly id: string;
  readonly number: string;
  readonly soldAt: string;
  readonly total: Money;
  /** Where its outbox entry stands. */
  readonly syncState: OutboxState | undefined;
  readonly rejectionCode: string | null;
}

/** The newest invoices this device made, with whether the server has them. */
export async function listLocalInvoices(
  executor: LocalExecutor,
  limit = 20,
): Promise<LocalInvoice[]> {
  const rows = await localOrm(executor)
    .select()
    .from(localInvoices)
    .orderBy(desc(localInvoices.docSeq))
    .limit(limit);
  const states = await operationStates(
    executor,
    rows.map((row) => row.opId),
  );
  return rows.map((row) => {
    const state = states.get(row.opId);
    return {
      id: row.id,
      number: row.number,
      soldAt: row.soldAt,
      total: Money.of(
        Decimal.fromScaledInteger(row.totalScaled, AMOUNT_SCALE).toString(),
        priceCurrency(row.currency),
      ),
      syncState: state?.state,
      rejectionCode: state?.rejectionCode ?? null,
    };
  });
}

export const cartQueryKey = ["local", "sales", "cart"] as const;
export const localInvoicesQueryKey = ["local", "sales", "invoices"] as const;

export function cartQueryOptions(db: LocalDb, baseCurrency: string) {
  return queryOptions({
    queryKey: [...cartQueryKey, baseCurrency],
    queryFn: () => readCart(db, baseCurrency),
    networkMode: "always",
    meta: { localTables: [CART_TABLE, LOCAL_PRODUCTS_TABLE] },
  });
}

export function localInvoicesQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: localInvoicesQueryKey,
    queryFn: () => listLocalInvoices(db),
    networkMode: "always",
    meta: { localTables: [LOCAL_INVOICES_TABLE, OUTBOX_TABLE] },
  });
}

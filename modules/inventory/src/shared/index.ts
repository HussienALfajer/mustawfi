import { decimalString } from "@mustawfi/kernel";
import { z } from "zod";

export const productNameSchema = z.string().trim().min(1).max(200);

/** What a scanner reads: 1–64 printable ASCII characters, no spaces. */
export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[\x21-\x7E]{1,64}$/, "a barcode is 1–64 printable characters without spaces");

/** A unit price with its currency: merchants price in USD or SYP (AGENTS.md, dollarization). */
export const priceSchema = z.object({
  /** A unit price, `numeric(20,6)` (ADR-0018): not rounded until it becomes a line amount. */
  amount: decimalString({ scale: 6, sign: "nonNegative" }),
  currency: z.string().regex(/^[A-Z]{3}$/, "a currency is an ISO 4217 code"),
});

/** `POST /api/v1/inventory/products`. */
export const newProductSchema = z.object({
  name: productNameSchema,
  barcode: barcodeSchema.optional(),
  price: priceSchema,
});

export type NewProductInput = z.input<typeof newProductSchema>;

export const productSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  barcode: z.string().nullable(),
  price: priceSchema,
  createdAt: z.iso.datetime(),
});

export type ProductView = z.infer<typeof productSchema>;

export const PRODUCT_PAGE_LIMIT = 100;

/** `GET /api/v1/inventory/products?limit=&after=`: pages in creation order. */
export const productListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(PRODUCT_PAGE_LIMIT),
  /** The last id of the previous page. */
  after: z.uuid().optional(),
});

export const productPageSchema = z.object({
  items: z.array(productSchema),
  /** Pass as `after` for the next page; `null` on the last page. */
  next: z.uuid().nullable(),
});

/** The refusals of `inventory`; clients map each code to an Arabic message. */
export const inventoryProblemCodes = {
  /** Another of the tenant's products already has this barcode. */
  barcodeTaken: "inventory.product.barcodeTaken",
} as const;

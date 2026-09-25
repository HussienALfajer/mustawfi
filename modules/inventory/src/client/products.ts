import { apiRequest } from "@mustawfi/core-config/client";
import { Currency } from "@mustawfi/kernel";
import { queryOptions } from "@tanstack/react-query";
import {
  type NewProductInput,
  PRODUCT_PAGE_LIMIT,
  productPageSchema,
  productSchema,
  type ProductView,
} from "../shared/index.ts";

/**
 * The currencies a price can be set in, until `core.currency` supplies them: the new Syrian
 * pound and the US dollar, both with two minor units (AGENTS.md, dollarization).
 */
export const PRICE_CURRENCIES: readonly Currency[] = [Currency.of("SYP", 2), Currency.of("USD", 2)];

/** A price's currency; one outside the list keeps its code with two minor units. */
export function priceCurrency(code: string): Currency {
  return PRICE_CURRENCIES.find((currency) => currency.code === code) ?? Currency.of(code, 2);
}

export const productsQueryKey = ["inventory", "products"] as const;

/** Every product, page by page in creation order. Online for now; the local database later. */
export async function fetchProducts(signal?: AbortSignal): Promise<ProductView[]> {
  const products: ProductView[] = [];
  let after: string | null = null;
  do {
    const query = new URLSearchParams({ limit: String(PRODUCT_PAGE_LIMIT) });
    if (after !== null) query.set("after", after);
    const page = await apiRequest(`/api/v1/inventory/products?${query.toString()}`, {
      schema: productPageSchema,
      ...(signal === undefined ? {} : { signal }),
    });
    products.push(...page.items);
    after = page.next;
  } while (after !== null);
  return products;
}

export function productsQueryOptions() {
  return queryOptions({
    queryKey: productsQueryKey,
    queryFn: ({ signal }) => fetchProducts(signal),
  });
}

export function createProduct(input: NewProductInput): Promise<ProductView> {
  return apiRequest("/api/v1/inventory/products", {
    method: "POST",
    body: input,
    schema: productSchema,
  });
}

import { apiRequest } from "@mustawfi/core-config/client";
import { catalogCurrencies, findCatalogCurrency } from "@mustawfi/core-currency/shared";
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
 * The currencies a price can be set in: the currency catalog's, with their minor units
 * (`core.currency`; AGENTS.md, dollarization). The tenant's enabled currencies narrow it once
 * devices pull them (`core-money` slices 2–3).
 */
export const PRICE_CURRENCIES: readonly Currency[] = catalogCurrencies();

/** A price's currency; one outside the catalog keeps its code with two minor units. */
export function priceCurrency(code: string): Currency {
  return findCatalogCurrency(code) ?? Currency.of(code, 2);
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

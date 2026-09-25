export type { InventoryContext } from "./dependencies.ts";
export { inventoryModule } from "./manifest.ts";
export { createProduct, listProducts, type NewProduct } from "./products.ts";
export { knownProducts, moveStock, type StockLevel, type StockMovementBatch } from "./stock.ts";

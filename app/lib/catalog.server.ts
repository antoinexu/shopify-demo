/**
 * Catalog source switch.
 *
 * Loaders import from here and never from a concrete adapter, so swapping mock
 * data for a live store is an environment change, not a code change:
 *
 *   CATALOG_SOURCE=mock      (default) in-memory fixtures, no configuration
 *   CATALOG_SOURCE=shopify   live Storefront API, needs SHOPIFY_* variables
 *
 * The `.server` suffix is load-bearing: the Shopify adapter reads process.env and
 * calls fetch, so this module must never reach the client bundle. Components that
 * need `formatMoney` or the types import ./catalog/types instead.
 */

import { mockCatalog } from "./catalog/mock.server";
import { shopifyCatalog } from "./catalog/shopify.server";
import type { CatalogAdapter } from "./catalog/types";

const SOURCES: Record<string, CatalogAdapter> = {
  mock: mockCatalog,
  shopify: shopifyCatalog,
};

function selectAdapter(): CatalogAdapter {
  const requested = process.env.CATALOG_SOURCE ?? "mock";
  const adapter = SOURCES[requested];

  // Fail loudly. Silently falling back to mock data is how you end up "verifying"
  // a migration against fixtures and declaring success.
  if (!adapter) {
    throw new Error(
      `Unknown CATALOG_SOURCE "${requested}". Expected one of: ${Object.keys(SOURCES).join(", ")}`,
    );
  }

  return adapter;
}

export const catalog = selectAdapter();

/** Which backend is live — rendered in the dev banner so you always know what you are looking at. */
export const catalogSource = catalog.name;

export const getProducts = () => catalog.getProducts();
export const getProductByHandle = (handle: string) => catalog.getProductByHandle(handle);
export const getVariantsByIds = (variantIds: string[]) => catalog.getVariantsByIds(variantIds);

/** Convenience wrapper for the single-variant case. */
export async function getVariantById(variantId: string) {
  const [variant] = await catalog.getVariantsByIds([variantId]);
  return variant ?? null;
}

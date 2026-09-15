/**
 * Catalog types and the adapter contract.
 *
 * This module is **client-safe** (no `.server` suffix): components import
 * `formatMoney` and these types directly. Keep it free of anything that reads
 * `process.env` or touches the network, or the client build will break.
 *
 * The shapes mirror the Shopify Storefront API, which is what lets the mock and
 * the live adapter be swapped without touching a single component.
 */

export type Money = {
  amount: string;
  currencyCode: string;
};

export type ProductImage = {
  url: string;
  altText: string;
};

export type ProductVariant = {
  id: string;
  title: string;
  availableForSale: boolean;
  price: Money;
};

export type Product = {
  id: string;
  handle: string;
  title: string;
  description: string;
  priceRange: { minVariantPrice: Money };
  images: ProductImage[];
  variants: ProductVariant[];
};

export type VariantWithProduct = ProductVariant & { product: Product };

/**
 * Every catalog backend implements this. Adding a source (a CSV export, a
 * staging store, a different platform) means writing one more of these.
 */
export type CatalogAdapter = {
  /** Human-readable name, surfaced in logs and the dev banner. */
  readonly name: string;
  getProducts(): Promise<Product[]>;
  getProductByHandle(handle: string): Promise<Product | null>;
  /**
   * Batched on purpose. The cart resolves every line at once, and issuing one
   * network round trip per line against a real store is an N+1 that shows up
   * immediately on a cart with a handful of items.
   */
  getVariantsByIds(variantIds: string[]): Promise<VariantWithProduct[]>;
};

/** Shown when a product has no image at all — real catalogs are full of these. */
export const PLACEHOLDER_IMAGE: ProductImage = {
  url: "/images/placeholder.svg",
  altText: "",
};

export function formatMoney({ amount, currencyCode }: Money): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(Number(amount));
}

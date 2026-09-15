/**
 * Catalog types and the adapter contract.
 *
 * This module is **client-safe** (no `.server` suffix): components import these
 * types and `toProductSummary` directly. Keep it free of anything that reads
 * `process.env` or touches the network, or the client build will break.
 * Formatting and arithmetic for prices live in ../money.
 *
 * The shapes mirror the Shopify Storefront API, which is what lets the mock and
 * the live adapter be swapped without touching a single component.
 */

import type { Money } from "../money";

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

/**
 * What the product grid actually renders.
 *
 * The grid never shows a description or a variant list, but a `Product` carries
 * both — a description plus up to 250 variants each. Handing the full shape to
 * the home loader means all of it is serialized into the SSR payload and shipped
 * to the browser to be thrown away: harmless against six fixtures, and a
 * multi-megabyte document against a migrated store with a few thousand products.
 *
 * Trimming happens in the loader, so the cost scales with what is displayed
 * rather than with what the catalog happens to hold.
 */
export type ProductSummary = {
  id: string;
  handle: string;
  title: string;
  image: ProductImage;
  minPrice: Money;
  /** False when every variant is unavailable — drives the "Sold out" tag. */
  availableForSale: boolean;
};

export function toProductSummary(product: Product): ProductSummary {
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    // Adapters guarantee a non-empty images array, so index 0 is always safe
    image: product.images[0],
    minPrice: product.priceRange.minVariantPrice,
    availableForSale: product.variants.some((variant) => variant.availableForSale),
  };
}

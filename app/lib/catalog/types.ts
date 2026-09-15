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

/**
 * Money arithmetic in integer minor units.
 *
 * To be precise about why: the two operations this app performs today — a price
 * times an integer quantity, and a sum of two-decimal amounts — survive float
 * arithmetic, because `toFixed(2)` rounds the error away. That is luck, and it
 * runs out the moment a percentage is involved: 8.25% tax on $6.00 is "0.49" in
 * floats and "0.50" in cents, and tax, discounts and partial refunds are exactly
 * what a storefront grows next.
 *
 * Doing it in integers means the correctness argument is "cents cannot lose a
 * fraction" rather than "the rounding happens to absorb it".
 *
 * The scale is fixed at 100 because that is what the rest of the app already
 * assumes (every amount is rendered with `toFixed(2)`). Zero-decimal currencies
 * like JPY still round-trip correctly — Intl drops the decimals at display time —
 * but a store dealing in them should scale per currency rather than globally.
 */
const MINOR_UNIT_SCALE = 100;

/** "89.00" → 8900. Takes a number too, since shipping fees are configured as plain numbers. */
export function toMinorUnits(amount: string | number): number {
  return Math.round(Number(amount) * MINOR_UNIT_SCALE);
}

/** 8900 → { amount: "89.00" }. */
export function fromMinorUnits(minor: number, currencyCode: string): Money {
  return { amount: (minor / MINOR_UNIT_SCALE).toFixed(2), currencyCode };
}

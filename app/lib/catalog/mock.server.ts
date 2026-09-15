/**
 * In-memory catalog. The default source, so the app runs with zero configuration.
 *
 * The data is invented; only the *shape* matters, and that is defined by
 * CatalogAdapter in ./types.
 */

import type { CatalogAdapter, Product, VariantWithProduct } from "./types";

const CURRENCY = "USD";

function money(amount: number) {
  return { amount: amount.toFixed(2), currencyCode: CURRENCY };
}

const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    handle: "aurora-hoodie",
    title: "Aurora Hoodie",
    description:
      "13 oz double-faced fleece with a dropped shoulder. Survived 20 wash cycles without pilling or losing its shape — the one thing in your closet that never requires a decision.",
    priceRange: { minVariantPrice: money(89) },
    images: [{ url: "/images/aurora-hoodie.svg", altText: "Aurora Hoodie" }],
    variants: [
      { id: "gid://shopify/ProductVariant/101", title: "S / Fog Grey", availableForSale: true, price: money(89) },
      { id: "gid://shopify/ProductVariant/102", title: "M / Fog Grey", availableForSale: true, price: money(89) },
      { id: "gid://shopify/ProductVariant/103", title: "L / Fog Grey", availableForSale: false, price: money(89) },
      { id: "gid://shopify/ProductVariant/104", title: "M / Ink Black", availableForSale: true, price: money(98) },
    ],
  },
  {
    id: "gid://shopify/Product/2",
    handle: "drift-tote",
    title: "Drift Canvas Tote",
    description:
      "16 oz heavyweight canvas with a divided interior pocket that fits a 16-inch laptop. The glued and reinforced base holds books — or a watermelon.",
    priceRange: { minVariantPrice: money(58) },
    images: [{ url: "/images/drift-tote.svg", altText: "Drift Canvas Tote" }],
    variants: [
      { id: "gid://shopify/ProductVariant/201", title: "Standard / Natural", availableForSale: true, price: money(58) },
      { id: "gid://shopify/ProductVariant/202", title: "Standard / Olive", availableForSale: true, price: money(58) },
    ],
  },
  {
    id: "gid://shopify/Product/3",
    handle: "ember-mug",
    title: "Ember Insulated Mug",
    description:
      "316 stainless steel liner, six hours of heat retention. The lid disassembles completely for washing, so nothing lingers.",
    priceRange: { minVariantPrice: money(32) },
    images: [{ url: "/images/ember-mug.svg", altText: "Ember Insulated Mug" }],
    variants: [
      { id: "gid://shopify/ProductVariant/301", title: "12 oz / Sand Silver", availableForSale: true, price: money(32) },
      { id: "gid://shopify/ProductVariant/302", title: "17 oz / Sand Silver", availableForSale: true, price: money(38) },
      { id: "gid://shopify/ProductVariant/303", title: "17 oz / Burnt Orange", availableForSale: true, price: money(38) },
    ],
  },
  {
    id: "gid://shopify/Product/4",
    handle: "meridian-lamp",
    title: "Meridian Magnetic Reading Light",
    description:
      "Stepless dimming across three color temperatures. The magnetic base detaches to work as a flashlight. 30 hours on a full charge.",
    priceRange: { minVariantPrice: money(64) },
    images: [{ url: "/images/meridian-lamp.svg", altText: "Meridian Magnetic Reading Light" }],
    variants: [
      { id: "gid://shopify/ProductVariant/401", title: "Standard / Matte White", availableForSale: true, price: money(64) },
      { id: "gid://shopify/ProductVariant/402", title: "Standard / Charcoal", availableForSale: false, price: money(64) },
    ],
  },
  {
    id: "gid://shopify/Product/5",
    handle: "trail-cap",
    title: "Trail 5-Panel Cap",
    description:
      "Washed cotton khaki with an adjustable metal clasp. The brim arrives pre-curved, so you don't have to break it in.",
    priceRange: { minVariantPrice: money(28) },
    images: [{ url: "/images/trail-cap.svg", altText: "Trail 5-Panel Cap" }],
    variants: [
      { id: "gid://shopify/ProductVariant/501", title: "One Size / Khaki", availableForSale: true, price: money(28) },
      { id: "gid://shopify/ProductVariant/502", title: "One Size / Navy", availableForSale: true, price: money(28) },
    ],
  },
  {
    id: "gid://shopify/Product/6",
    handle: "linen-throw",
    title: "Linen Washed Throw",
    description:
      "French linen that softens with every wash. At 51 × 67 inches it covers a sofa or a twin bed.",
    priceRange: { minVariantPrice: money(112) },
    images: [{ url: "/images/linen-throw.svg", altText: "Linen Washed Throw" }],
    variants: [
      { id: "gid://shopify/ProductVariant/601", title: "51 × 67 in / Oat", availableForSale: true, price: money(112) },
      { id: "gid://shopify/ProductVariant/602", title: "51 × 67 in / Mist Blue", availableForSale: true, price: money(112) },
    ],
  },
];

/** Fake network latency so loading states are actually visible in the demo. */
function delay(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockCatalog: CatalogAdapter = {
  name: "mock",

  async getProducts() {
    await delay();
    return PRODUCTS;
  },

  async getProductByHandle(handle) {
    await delay();
    return PRODUCTS.find((product) => product.handle === handle) ?? null;
  },

  async getVariantsByIds(variantIds) {
    await delay(0);
    const wanted = new Set(variantIds);
    const found: VariantWithProduct[] = [];
    for (const product of PRODUCTS) {
      for (const variant of product.variants) {
        if (wanted.has(variant.id)) found.push({ ...variant, product });
      }
    }
    return found;
  },
};

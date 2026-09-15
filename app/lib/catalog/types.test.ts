import { describe, expect, it } from "vitest";
import { formatMoney, toProductSummary, type Product } from "./types";

/**
 * Money arrives from Shopify as a decimal string plus a currency code, never a
 * number. Formatting has to honour whatever currency the store actually uses —
 * hardcoding a symbol is a bug that only shows up after a migration.
 */
describe("formatMoney", () => {
  it("formats USD", () => {
    expect(formatMoney({ amount: "89.00", currencyCode: "USD" })).toBe("$89.00");
  });

  it("formats a currency the demo does not ship with", () => {
    expect(formatMoney({ amount: "120.00", currencyCode: "EUR" })).toBe("€120.00");
  });

  it("keeps two decimal places for a whole amount", () => {
    expect(formatMoney({ amount: "9", currencyCode: "USD" })).toBe("$9.00");
  });

  it("groups thousands", () => {
    expect(formatMoney({ amount: "1234.50", currencyCode: "USD" })).toBe("$1,234.50");
  });

  it("renders zero rather than an empty string", () => {
    expect(formatMoney({ amount: "0.00", currencyCode: "USD" })).toBe("$0.00");
  });

  it("respects a zero-decimal currency", () => {
    // JPY has no minor unit; Intl knows this and the code must not force 2 digits
    expect(formatMoney({ amount: "1200", currencyCode: "JPY" })).toBe("¥1,200");
  });
});

/**
 * The grid's payload shape. These assert on what is *dropped* as much as on what
 * is kept — the whole point of the summary is that a description and a long
 * variant list never reach the browser.
 */
describe("toProductSummary", () => {
  const product: Product = {
    id: "gid://shopify/Product/1",
    handle: "aurora-hoodie",
    title: "Aurora Hoodie",
    description: "A long description the product grid never renders.",
    priceRange: { minVariantPrice: { amount: "89.00", currencyCode: "USD" } },
    images: [
      { url: "/images/aurora-hoodie.svg", altText: "Aurora Hoodie" },
      { url: "/images/aurora-hoodie-back.svg", altText: "Aurora Hoodie, back" },
    ],
    variants: [
      { id: "v1", title: "S", availableForSale: false, price: { amount: "89.00", currencyCode: "USD" } },
      { id: "v2", title: "M", availableForSale: true, price: { amount: "98.00", currencyCode: "USD" } },
    ],
  };

  it("keeps only the fields the card renders", () => {
    expect(toProductSummary(product)).toEqual({
      id: "gid://shopify/Product/1",
      handle: "aurora-hoodie",
      title: "Aurora Hoodie",
      image: { url: "/images/aurora-hoodie.svg", altText: "Aurora Hoodie" },
      minPrice: { amount: "89.00", currencyCode: "USD" },
      availableForSale: true,
    });
  });

  it("drops the description and the variant list from the payload", () => {
    const summary = toProductSummary(product) as Record<string, unknown>;
    expect(summary.description).toBeUndefined();
    expect(summary.variants).toBeUndefined();
    expect(summary.images).toBeUndefined();
  });

  it("is available when any single variant is", () => {
    expect(toProductSummary(product).availableForSale).toBe(true);
  });

  it("is sold out only when every variant is unavailable", () => {
    const soldOut = {
      ...product,
      variants: product.variants.map((variant) => ({ ...variant, availableForSale: false })),
    };
    expect(toProductSummary(soldOut).availableForSale).toBe(false);
  });

  it("treats a product with no variants as sold out rather than throwing", () => {
    expect(toProductSummary({ ...product, variants: [] }).availableForSale).toBe(false);
  });

  it("takes the first image, which adapters guarantee exists", () => {
    expect(toProductSummary(product).image.url).toBe("/images/aurora-hoodie.svg");
  });
});

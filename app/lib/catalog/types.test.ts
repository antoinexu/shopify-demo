import { describe, expect, it } from "vitest";
import { formatMoney } from "./types";

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

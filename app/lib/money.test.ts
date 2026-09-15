import { describe, expect, it } from "vitest";
import { formatMoney, fromMinorUnits, toMinorUnits } from "./money";

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
 * Money is parsed to integer minor units before any arithmetic happens.
 *
 * Note what is *not* claimed here: the app's current arithmetic (price times
 * quantity, and sums of two-decimal amounts) gives the same answer either way,
 * because toFixed(2) rounds the float error away. The percentage case below is
 * the one that genuinely diverges, and it is the reason to work in cents.
 */
describe("minor units", () => {
  it("parses a decimal string to cents", () => {
    expect(toMinorUnits("89.00")).toBe(8900);
    expect(toMinorUnits("0.67")).toBe(67);
  });

  it("parses a plain number, which is how shipping fees are configured", () => {
    expect(toMinorUnits(15)).toBe(1500);
    expect(toMinorUnits(0)).toBe(0);
  });

  it("absorbs float noise from an upstream computation instead of truncating it", () => {
    // 0.1 + 0.2 is 0.30000000000000004; parsing must land on 30, not 30.000000004
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(Number.isInteger(toMinorUnits(1.005))).toBe(true);
  });

  it("renders cents back as a two-decimal string", () => {
    expect(fromMinorUnits(8900, "USD")).toEqual({ amount: "89.00", currencyCode: "USD" });
    expect(fromMinorUnits(0, "USD").amount).toBe("0.00");
  });

  it("round-trips without drift", () => {
    for (const amount of ["0.01", "0.67", "19.99", "89.00", "1234.56"]) {
      expect(fromMinorUnits(toMinorUnits(amount), "USD").amount).toBe(amount);
    }
  });

  it("computes a percentage where the float path is a cent short", () => {
    // 8.25% sales tax on $6.00. The float path — Number("6.00") * 0.0825 then
    // toFixed(2) — yields "0.49"; the customer is undercharged by a cent, and
    // every such line drifts the books a little further.
    const taxed = fromMinorUnits(Math.round(toMinorUnits("6.00") * 0.0825), "USD");
    expect(taxed.amount).toBe("0.50");
    expect((6.0 * 0.0825).toFixed(2)).toBe("0.49");
  });

  it("sums a multi-line subtotal exactly", () => {
    const cents = ["0.10", "0.20", "19.99"].reduce((sum, a) => sum + toMinorUnits(a), 0);
    expect(fromMinorUnits(cents, "USD").amount).toBe("20.29");
  });
});

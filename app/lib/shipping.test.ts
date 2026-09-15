import { describe, expect, it } from "vitest";
import { getShippingMethod, isValidStateCode, SHIPPING_METHODS, US_STATES } from "./shipping";

describe("US_STATES", () => {
  it("covers the 50 states plus DC", () => {
    expect(US_STATES).toHaveLength(51);
  });

  it("has no duplicate codes", () => {
    const codes = US_STATES.map((state) => state.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses two uppercase letters for every code", () => {
    expect(US_STATES.every((state) => /^[A-Z]{2}$/.test(state.code))).toBe(true);
  });
});

describe("isValidStateCode", () => {
  it.each(["CA", "NY", "DC", "AK", "HI"])("accepts %s", (code) => {
    expect(isValidStateCode(code)).toBe(true);
  });

  it.each(["", "XX", "ca", "California", "C"])("rejects %s", (code) => {
    expect(isValidStateCode(code)).toBe(false);
  });
});

describe("getShippingMethod", () => {
  it("resolves each configured id", () => {
    for (const method of SHIPPING_METHODS) {
      expect(getShippingMethod(method.id).id).toBe(method.id);
    }
  });

  it("falls back to the first method for anything unrecognised", () => {
    expect(getShippingMethod("teleport").id).toBe(SHIPPING_METHODS[0].id);
    expect(getShippingMethod("").id).toBe(SHIPPING_METHODS[0].id);
  });
});

describe("SHIPPING_METHODS", () => {
  it("offers a free option first, which the checkout form preselects", () => {
    expect(SHIPPING_METHODS[0].fee).toBe(0);
  });

  it("prices every method at zero or above", () => {
    expect(SHIPPING_METHODS.every((method) => method.fee >= 0)).toBe(true);
  });
});

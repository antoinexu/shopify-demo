import { describe, expect, it } from "vitest";
import {
  addToCart,
  clearCart,
  getCart,
  getCartQuantity,
  removeCartLine,
  updateCartLine,
} from "./cart.server";
import { asRequestCookie } from "./test/routes";

/**
 * These drive the real cookie session round trip rather than poking at internals,
 * so the quantity clamping, the merge-on-re-add behaviour and the delete-at-zero
 * rule are all covered through the same surface the routes use.
 *
 * The catalog defaults to the mock adapter here, which is what makes getCart
 * resolvable without a network.
 */

const HOODIE_S = "gid://shopify/ProductVariant/101";
const HOODIE_M = "gid://shopify/ProductVariant/102";
const TOTE = "gid://shopify/ProductVariant/201";

function requestWith(setCookie?: string): Request {
  return new Request("http://localhost/cart", {
    headers: setCookie ? { Cookie: asRequestCookie(setCookie) } : {},
  });
}

/** Replays a sequence of cart writes, threading the cookie through as a browser would. */
async function replay(
  steps: ((request: Request) => Promise<string>)[],
): Promise<{ cookie: string; request: Request }> {
  let cookie = "";
  for (const step of steps) {
    cookie = await step(requestWith(cookie));
  }
  return { cookie, request: requestWith(cookie) };
}

describe("getCartQuantity", () => {
  it("is zero for a request with no cookie", async () => {
    expect(await getCartQuantity(new Request("http://localhost/"))).toBe(0);
  });

  it("sums quantities without touching the catalog", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 2),
      (r) => addToCart(r, TOTE, 3),
    ]);
    expect(await getCartQuantity(request)).toBe(5);
  });
});

describe("addToCart", () => {
  it("merges a repeat add into the existing line instead of duplicating it", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 2),
      (r) => addToCart(r, HOODIE_S, 3),
    ]);

    const cart = await getCart(request);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(5);
  });

  it("treats a zero or negative quantity as one, so the button always does something", async () => {
    const { request } = await replay([(r) => addToCart(r, HOODIE_S, 0)]);
    expect(await getCartQuantity(request)).toBe(1);
  });

  it("caps a single line at 99", async () => {
    const { request } = await replay([(r) => addToCart(r, HOODIE_S, 5000)]);
    expect(await getCartQuantity(request)).toBe(99);
  });

  it("caps the merged total at 99 as well", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 60),
      (r) => addToCart(r, HOODIE_S, 60),
    ]);
    expect(await getCartQuantity(request)).toBe(99);
  });

  it("ignores a non-numeric quantity rather than storing NaN", async () => {
    const { request } = await replay([(r) => addToCart(r, HOODIE_S, Number.NaN)]);
    expect(await getCartQuantity(request)).toBe(1);
  });
});

describe("getCart", () => {
  it("prices lines on the server from current catalog data", async () => {
    const { request } = await replay([(r) => addToCart(r, HOODIE_S, 2)]);

    const cart = await getCart(request);
    // Mock catalog prices the S / Fog Grey hoodie at 89.00
    expect(cart.lines[0].lineTotal).toEqual({ amount: "178.00", currencyCode: "USD" });
    expect(cart.subtotal).toEqual({ amount: "178.00", currencyCode: "USD" });
  });

  it("sums a multi-line cart", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 2), // 89.00 x2
      (r) => addToCart(r, TOTE, 1), // 58.00
    ]);

    const cart = await getCart(request);
    expect(cart.totalQuantity).toBe(3);
    expect(cart.subtotal.amount).toBe("236.00");
  });

  it("drops a line whose variant no longer resolves instead of throwing", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 1),
      (r) => addToCart(r, "gid://shopify/ProductVariant/does-not-exist", 1),
    ]);

    const cart = await getCart(request);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].variantId).toBe(HOODIE_S);
  });

  it("returns an empty cart for a request with no cookie", async () => {
    const cart = await getCart(new Request("http://localhost/"));
    expect(cart.lines).toEqual([]);
    expect(cart.totalQuantity).toBe(0);
    expect(cart.subtotal.amount).toBe("0.00");
  });
});

describe("updateCartLine", () => {
  it("sets an explicit quantity", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 2),
      (r) => updateCartLine(r, HOODIE_S, 7),
    ]);
    expect(await getCartQuantity(request)).toBe(7);
  });

  it("removes the line when the quantity reaches zero", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 2),
      (r) => addToCart(r, TOTE, 1),
      (r) => updateCartLine(r, HOODIE_S, 0),
    ]);

    const cart = await getCart(request);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].variantId).toBe(TOTE);
  });

  it("leaves other lines untouched", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 2),
      (r) => addToCart(r, HOODIE_M, 4),
      (r) => updateCartLine(r, HOODIE_S, 1),
    ]);

    const cart = await getCart(request);
    const byId = Object.fromEntries(cart.lines.map((line) => [line.variantId, line.quantity]));
    expect(byId).toEqual({ [HOODIE_S]: 1, [HOODIE_M]: 4 });
  });
});

describe("removeCartLine and clearCart", () => {
  it("removes one line", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 2),
      (r) => addToCart(r, TOTE, 1),
      (r) => removeCartLine(r, TOTE),
    ]);

    const cart = await getCart(request);
    expect(cart.lines.map((line) => line.variantId)).toEqual([HOODIE_S]);
  });

  it("empties everything", async () => {
    const { request } = await replay([
      (r) => addToCart(r, HOODIE_S, 2),
      (r) => addToCart(r, TOTE, 1),
      (r) => clearCart(r),
    ]);
    expect(await getCartQuantity(request)).toBe(0);
  });
});

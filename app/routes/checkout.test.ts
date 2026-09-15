import { describe, expect, it } from "vitest";
import type { Route } from "./+types/checkout";
import { action, loader } from "./checkout";
import { addToCart, getCart } from "~/lib/cart.server";
import { getOrder } from "~/lib/orders.server";

/**
 * Checkout is where the money is decided, so these tests care about two things
 * the field-level tests in lib/orders.test.ts cannot see:
 *
 *   1. the order is priced from the *server's* cart, never from the submitted
 *      form, so a tampered request cannot change what is charged;
 *   2. an empty or emptied cart can never produce an order.
 */

const HOODIE_S = "gid://shopify/ProductVariant/101"; // 89.00
const TOTE = "gid://shopify/ProductVariant/201"; // 58.00

const VALID = {
  name: "Jane Doe",
  phone: "(415) 555-0142",
  email: "jane@example.com",
  state: "CA",
  city: "San Francisco",
  address: "500 Howard St Apt 4",
  zip: "94103",
  note: "",
  shipping: "standard",
};

function asRequestCookie(setCookie: string): string {
  return setCookie.split(";")[0];
}

function get(cookie?: string): Request {
  return new Request("http://localhost/checkout", {
    headers: cookie ? { Cookie: asRequestCookie(cookie) } : {},
  });
}

function post(fields: Record<string, string>, cookie?: string): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);

  return new Request("http://localhost/checkout", {
    method: "POST",
    body,
    headers: cookie ? { Cookie: asRequestCookie(cookie) } : {},
  });
}

function args(request: Request) {
  return { request, params: {}, context: {} } as unknown as Route.ActionArgs;
}

/** A cart holding one hoodie and one tote: 89.00 + 58.00 = 147.00. */
async function cartWithTwoItems(): Promise<string> {
  const first = await addToCart(get(), HOODIE_S, 1);
  return addToCart(get(first), TOTE, 1);
}

/** Submits the checkout form and returns the redirect it produced. */
async function placeOrder(overrides: Record<string, string> = {}, cookie?: string) {
  const items = cookie ?? (await cartWithTwoItems());
  const response = await action(args(post({ ...VALID, ...overrides }, items)));

  expect(response, "a valid submission must redirect").toBeInstanceOf(Response);
  return response as Response;
}

/** `data(...)` returns a wrapper rather than a Response. */
function unwrap(result: unknown): { data: unknown; status: number } {
  const wrapper = result as { data: unknown; init?: ResponseInit | null };
  return { data: wrapper.data, status: wrapper.init?.status ?? 200 };
}

function orderIdFrom(response: Response): string {
  const location = response.headers.get("Location") ?? "";
  expect(location).toMatch(/^\/orders\/[0-9a-f]{32}$/);
  return location.split("/").pop()!;
}

describe("loader", () => {
  it("bounces an empty cart back to /cart instead of rendering a form that cannot submit", async () => {
    const thrown = await loader(args(get())).catch((error) => error);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe("/cart");
  });

  it("returns the priced cart when there is something to buy", async () => {
    const cookie = await cartWithTwoItems();

    const { cart } = await loader(args(get(cookie)));
    expect(cart.lines).toHaveLength(2);
    expect(cart.subtotal.amount).toBe("147.00");
  });
});

describe("a valid submission", () => {
  it("creates an order that is retrievable by the id in the redirect", async () => {
    const order = getOrder(orderIdFrom(await placeOrder()));

    expect(order).not.toBeNull();
    expect(order!.lines).toHaveLength(2);
    expect(order!.address).toMatchObject({ name: "Jane Doe", city: "San Francisco", state: "CA" });
  });

  it("prices the order from the server's cart, not from the form", async () => {
    // A tampered form carrying its own totals must have no effect whatsoever
    const response = await placeOrder({ subtotal: "1.00", total: "1.00" });
    const order = getOrder(orderIdFrom(response))!;

    expect(order.subtotal.amount).toBe("147.00");
    expect(order.total.amount).toBe("147.00");
  });

  it("adds the shipping fee to the total for express", async () => {
    const order = getOrder(orderIdFrom(await placeOrder({ shipping: "express" })))!;

    expect(order.shipping.id).toBe("express");
    expect(order.shippingFee.amount).toBe("15.00");
    expect(order.total.amount).toBe("162.00");
  });

  it("charges nothing for standard shipping", async () => {
    const order = getOrder(orderIdFrom(await placeOrder({ shipping: "standard" })))!;
    expect(order.shippingFee.amount).toBe("0.00");
    expect(order.total.amount).toBe("147.00");
  });

  it("empties the cart through the returned Set-Cookie", async () => {
    const response = await placeOrder();
    const setCookie = response.headers.get("Set-Cookie");

    expect(setCookie).toBeTruthy();
    expect((await getCart(get(setCookie!))).lines).toEqual([]);
  });

  it("gives each order an unguessable id, since the id is the only thing protecting it", async () => {
    const first = orderIdFrom(await placeOrder());
    const second = orderIdFrom(await placeOrder());
    expect(first).not.toBe(second);
  });
});

describe("an invalid submission", () => {
  it("comes back as a 400 with the offending fields flagged", async () => {
    const cookie = await cartWithTwoItems();
    const result = await action(args(post({ ...VALID, email: "not-an-email", zip: "1" }, cookie)));

    const { status, data } = unwrap(result);
    expect(status).toBe(400);
    expect(data).toMatchObject({ errors: { email: expect.any(String), zip: expect.any(String) } });
  });

  it("echoes the submitted values back so the customer does not retype the form", async () => {
    const cookie = await cartWithTwoItems();
    const result = await action(args(post({ ...VALID, zip: "1" }, cookie)));

    expect(unwrap(result).data).toMatchObject({
      values: { name: "Jane Doe", city: "San Francisco", zip: "1" },
    });
  });

  it("creates no order", async () => {
    const cookie = await cartWithTwoItems();
    const result = await action(args(post({ ...VALID, email: "nope" }, cookie)));

    // A redirect is the only path that reaches createOrder
    expect(result).not.toBeInstanceOf(Response);
    // And the cart is still intact, ready for a corrected submission
    expect((await getCart(get(cookie))).lines).toHaveLength(2);
  });

  it("rejects a shipping method that is not on offer rather than quietly billing standard", async () => {
    const cookie = await cartWithTwoItems();
    const result = await action(args(post({ ...VALID, shipping: "free-overnight" }, cookie)));

    expect(unwrap(result).status).toBe(400);
    expect(unwrap(result).data).toMatchObject({ errors: { shipping: expect.any(String) } });
  });
});

describe("the cart emptied while the form was open", () => {
  it("redirects to /cart instead of creating an empty order", async () => {
    const thrown = await action(args(post(VALID))).catch((error) => error);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/cart");
  });
});

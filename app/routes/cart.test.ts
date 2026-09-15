import { describe, expect, it } from "vitest";
import type { Route } from "./+types/cart";
import { action, loader } from "./cart";
import { addToCart, getCart } from "~/lib/cart.server";

/**
 * The cart route is the only write endpoint in the app: every add, update,
 * remove and clear in the UI posts here and is dispatched on `intent`. The unit
 * tests in lib/cart.test.ts cover the storage rules; these cover the HTTP shell
 * around them — dispatch, validation, status codes, and the Set-Cookie header
 * that makes the header badge revalidate.
 *
 * The loaders and actions are called directly rather than through a router.
 * They are plain async functions of a Request, which is exactly what makes them
 * testable without a server.
 */

const HOODIE_S = "gid://shopify/ProductVariant/101";
const TOTE = "gid://shopify/ProductVariant/201";

/** Turn a Set-Cookie response header back into a Cookie request header. */
function asRequestCookie(setCookie: string): string {
  return setCookie.split(";")[0];
}

function post(fields: Record<string, string>, cookie?: string): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);

  return new Request("http://localhost/cart", {
    method: "POST",
    body,
    headers: cookie ? { Cookie: asRequestCookie(cookie) } : {},
  });
}

function get(cookie?: string): Request {
  return new Request("http://localhost/cart", {
    headers: cookie ? { Cookie: asRequestCookie(cookie) } : {},
  });
}

/**
 * The route args carry `params` and `context` that neither the loader nor the
 * action reads; only the request matters here.
 */
function args(request: Request) {
  return { request, params: {}, context: {} } as unknown as Route.ActionArgs;
}

/** `data(...)` returns a wrapper, not a Response — unwrap both shapes the same way. */
function unwrap(result: unknown): { data: unknown; status: number; headers: Headers } {
  const wrapper = result as { data: unknown; init?: ResponseInit | null };
  const init = wrapper.init ?? {};
  return {
    data: wrapper.data,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
  };
}

/** Runs the action and returns the cookie it set, ready to feed into the next request. */
async function run(fields: Record<string, string>, cookie?: string): Promise<string> {
  const result = await action(args(post(fields, cookie)));
  const setCookie = unwrap(result).headers.get("Set-Cookie");
  expect(setCookie, "every successful cart write must set a cookie").toBeTruthy();
  return setCookie!;
}

describe("loader", () => {
  it("returns an empty cart when there is no cookie", async () => {
    const { cart } = await loader(args(get()));
    expect(cart.lines).toEqual([]);
    expect(cart.totalQuantity).toBe(0);
  });

  it("returns the priced cart for the request's cookie", async () => {
    const cookie = await addToCart(get(), HOODIE_S, 2);

    const { cart } = await loader(args(get(cookie)));
    expect(cart.lines).toHaveLength(1);
    expect(cart.subtotal.amount).toBe("178.00");
  });
});

describe("action dispatch", () => {
  it("rejects an unknown intent with a 400 rather than silently doing nothing", async () => {
    const thrown = await action(args(post({ intent: "delete-everything" }))).catch((error) => error);
    expect(unwrap(thrown).status).toBe(400);
    expect(unwrap(thrown).data).toMatchObject({ message: expect.stringContaining("delete-everything") });
  });

  it("rejects a missing intent", async () => {
    const thrown = await action(args(post({ variantId: HOODIE_S }))).catch((error) => error);
    expect(unwrap(thrown).status).toBe(400);
  });

  it("echoes the intent back so the UI can tell what completed", async () => {
    const result = await action(args(post({ intent: "add", variantId: HOODIE_S, quantity: "1" })));
    expect(unwrap(result).data).toMatchObject({ ok: true, intent: "add" });
  });
});

describe("intent=add", () => {
  it("adds the variant and sets a cookie the next request can read", async () => {
    const cookie = await run({ intent: "add", variantId: HOODIE_S, quantity: "2" });

    const cart = await getCart(get(cookie));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ variantId: HOODIE_S, quantity: 2 });
  });

  it("defaults to a quantity of one when the form omits it", async () => {
    const cookie = await run({ intent: "add", variantId: HOODIE_S });
    expect((await getCart(get(cookie))).totalQuantity).toBe(1);
  });

  it("refuses an unknown variant instead of writing it to the cookie", async () => {
    const thrown = await action(
      args(post({ intent: "add", variantId: "gid://shopify/ProductVariant/nope" })),
    ).catch((error) => error);

    expect(unwrap(thrown).status).toBe(400);
    // No cookie was set, so nothing can have been stored
    expect(unwrap(thrown).headers.get("Set-Cookie")).toBeNull();
  });

  it("merges a repeat add into the existing line", async () => {
    let cookie = await run({ intent: "add", variantId: HOODIE_S, quantity: "2" });
    cookie = await run({ intent: "add", variantId: HOODIE_S, quantity: "3" }, cookie);

    const cart = await getCart(get(cookie));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(5);
  });
});

describe("intent=update", () => {
  it("sets an explicit quantity", async () => {
    let cookie = await run({ intent: "add", variantId: HOODIE_S, quantity: "2" });
    cookie = await run({ intent: "update", variantId: HOODIE_S, quantity: "7" }, cookie);

    expect((await getCart(get(cookie))).lines[0].quantity).toBe(7);
  });

  it("removes the line at zero, which is what the stepper's minus button sends at one", async () => {
    let cookie = await run({ intent: "add", variantId: HOODIE_S, quantity: "1" });
    cookie = await run({ intent: "update", variantId: HOODIE_S, quantity: "0" }, cookie);

    expect((await getCart(get(cookie))).lines).toEqual([]);
  });

  it("does not validate the variant, since an update can only touch what is already stored", async () => {
    const cookie = await run({ intent: "update", variantId: "gid://shopify/ProductVariant/nope", quantity: "3" });
    expect((await getCart(get(cookie))).lines).toEqual([]);
  });
});

describe("intent=remove and intent=clear", () => {
  it("removes one line and leaves the rest", async () => {
    let cookie = await run({ intent: "add", variantId: HOODIE_S, quantity: "2" });
    cookie = await run({ intent: "add", variantId: TOTE, quantity: "1" }, cookie);
    cookie = await run({ intent: "remove", variantId: HOODIE_S }, cookie);

    const cart = await getCart(get(cookie));
    expect(cart.lines.map((line) => line.variantId)).toEqual([TOTE]);
  });

  it("empties the whole cart", async () => {
    let cookie = await run({ intent: "add", variantId: HOODIE_S, quantity: "2" });
    cookie = await run({ intent: "add", variantId: TOTE, quantity: "1" }, cookie);
    cookie = await run({ intent: "clear" }, cookie);

    expect((await getCart(get(cookie))).totalQuantity).toBe(0);
  });
});

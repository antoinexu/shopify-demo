import { describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router";
import type { Route } from "./+types/cart";
import { action, loader } from "./cart";
import { addToCart, getCart, getCartQuantity } from "~/lib/cart.server";
import { MAX_CART_LINES } from "~/lib/cart";
import { loader as rootLoader, shouldRevalidate } from "~/root";
import type { Route as RootRoute } from "../+types/root";
import { asRequestCookie, routeArgs, unwrap } from "~/lib/test/routes";

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
/** availableForSale: false in the mock fixtures */
const HOODIE_L_SOLD_OUT = "gid://shopify/ProductVariant/103";

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

/** Neither the loader nor the action reads params or context; only the request matters here. */
const args = (request: Request) => routeArgs<Route.ActionArgs>(request);

/** Runs the action and returns the cookie it set, ready to feed into the next request. */
async function run(fields: Record<string, string>, cookie?: string): Promise<string> {
  const result = await action(args(post(fields, cookie)));
  const setCookie = unwrap(result).headers.get("Set-Cookie");
  expect(setCookie, "every successful cart write must set a cookie").toBeTruthy();
  return setCookie!;
}

describe("loader", () => {
  it("keeps the badge right on the cart page and after leaving it", async () => {
    let cookie = await addToCart(get(), HOODIE_S, 2);
    cookie = await addToCart(get(cookie), "gid://shopify/ProductVariant/deleted", 3);
    const withCookie = (request: Request) => new Request(request, { headers: { Cookie: asRequestCookie(cookie) } });
    const router = createMemoryRouter([{
      id: "root", path: "/", shouldRevalidate,
      loader: ({ request }) => rootLoader(routeArgs<RootRoute.LoaderArgs>(withCookie(request))),
      children: [
        { index: true },
        { id: "routes/cart", path: "cart", loader: async ({ request }) => {
          const result = await loader(args(withCookie(request)));
          cookie = new Headers(result.init?.headers).get("Set-Cookie") ?? cookie;
          return result;
        } },
      ],
    }], { initialEntries: ["/"] });
    try {
      if (!router.state.initialized) {
        await new Promise<void>(resolve => {
          const unsubscribe = router.subscribe(state => {
            if (state.initialized) { unsubscribe(); resolve(); }
          });
        });
      }
      // Away from the cart the badge is the cheap cookie count, delisted line included
      expect(router.state.loaderData.root.cartQuantity).toBe(5);
      await router.navigate("/cart");
      // On the cart page Layout shows the cart loader's resolved count instead
      expect(router.state.loaderData["routes/cart"].cart.totalQuantity).toBe(2);
      // Leaving the cart reruns the root loader against the cleaned cookie
      await router.navigate("/");
      expect(router.state.loaderData.root.cartQuantity).toBe(2);
    } finally {
      router.dispose();
    }
  });
  it("returns an empty cart when there is no cookie", async () => {
    const { cart } = (await loader(args(get()))).data;
    expect(cart.lines).toEqual([]);
    expect(cart.totalQuantity).toBe(0);
  });

  it("returns the priced cart for the request's cookie", async () => {
    const cookie = await addToCart(get(), HOODIE_S, 2);

    const { cart } = (await loader(args(get(cookie)))).data;
    expect(cart.lines).toHaveLength(1);
    expect(cart.subtotal.amount).toBe("178.00");
  });

  it("removes deleted lines from the cookie and corrects the badge on the same visit", async () => {
    let cookie = await addToCart(get(), HOODIE_S, 2);
    cookie = await addToCart(get(cookie), "gid://shopify/ProductVariant/deleted", 3);
    const request = get(cookie);
    const result = await loader(args(request));
    expect(result.data.cart.missingItems).toHaveLength(1);
    // The badge on this visit comes from the cart loader's own count
    expect(result.data.cart.totalQuantity).toBe(2);
    const cleanedCookie = new Headers(result.init?.headers).get("Set-Cookie")!;
    expect(cleanedCookie).toBeTruthy();
    expect(await getCartQuantity(get(cleanedCookie))).toBe(2);
    expect((await getCart(get(cleanedCookie))).missingItems).toEqual([]);
  });

  it("shows the removal even when every cart line was deleted", async () => {
    const cookie = await addToCart(get(), "gid://shopify/ProductVariant/deleted", 1);
    const result = await loader(args(get(cookie)));
    expect(result.data.cart.lines).toEqual([]);
    expect(result.data.cart.missingItems).toHaveLength(1);
    expect(new Headers(result.init?.headers).get("Set-Cookie")).toBeTruthy();
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
  it("returns an actionable capacity error without changing the cart", async () => {
    let cookie = "";
    for (let i = 0; i < MAX_CART_LINES; i++) {
      cookie = await addToCart(get(cookie), `gid://shopify/ProductVariant/${10000000000000 + i}`, 1);
    }
    const result = await action(args(post({ intent: "add", variantId: HOODIE_S }, cookie)));
    expect(unwrap(result).status).toBe(400);
    expect(unwrap(result).data).toMatchObject({ ok: false, code: "CART_FULL" });
    expect(unwrap(result).headers.get("Set-Cookie")).toBeNull();
    expect(await getCartQuantity(get(cookie))).toBe(MAX_CART_LINES);
  });
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

  it("refuses a sold-out variant with a 409 the form can show, and writes nothing", async () => {
    // The product page disables this option; a direct POST is the only way to send it
    const result = await action(args(post({ intent: "add", variantId: HOODIE_L_SOLD_OUT })));

    const { status, data, headers } = unwrap(result);
    expect(status).toBe(409);
    expect(data).toMatchObject({ ok: false, variantId: HOODIE_L_SOLD_OUT, message: expect.any(String) });
    expect(headers.get("Set-Cookie")).toBeNull();
  });

  it("returns the sold-out refusal rather than throwing it, so the product page survives", async () => {
    // A thrown response would replace the page with the error boundary
    await expect(
      action(args(post({ intent: "add", variantId: HOODIE_L_SOLD_OUT }))),
    ).resolves.toBeDefined();
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

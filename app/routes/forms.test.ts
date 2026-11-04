import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  createStaticHandler, createStaticRouter, StaticRouterProvider,
  useActionData, useLoaderData,
} from "react-router";
import { describe, expect, it } from "vitest";
import Product, { loader as productLoader } from "./product";
import Checkout, { action as checkoutAction, loader as checkoutLoader } from "./checkout";
import { action as cartAction } from "./cart";
import type { Route as ProductRoute } from "./+types/product";
import type { Route as CheckoutRoute } from "./+types/checkout";
import type { Route as CartRoute } from "./+types/cart";
import { addToCart, getCart } from "~/lib/cart.server";
import { getOrder } from "~/lib/orders.server";
import { asRequestCookie, routeArgs } from "~/lib/test/routes";

const VALID = {
  name: "Jane Doe", phone: "4155550142", email: "jane@example.com",
  state: "CA", city: "San Francisco", address: "500 Howard St", zip: "94103",
};

const handler = createStaticHandler([
  {
    path: "/products/:handle",
    loader: ({ request, params }) => productLoader(routeArgs<ProductRoute.LoaderArgs>(request, { handle: params.handle! })),
    Component: () => createElement(Product, { loaderData: useLoaderData() } as ProductRoute.ComponentProps),
  },
  {
    path: "/checkout", loader: checkoutLoader, action: checkoutAction,
    Component: () => createElement(Checkout, {
      loaderData: useLoaderData(), actionData: useActionData(),
    } as CheckoutRoute.ComponentProps),
  },
]);

async function render(request: Request) {
  const context = await handler.query(request);
  if (context instanceof Response) throw new Error(`Unexpected redirect: ${context.headers.get("Location")}`);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(StaticRouterProvider, { router, context }));
}

function post(fields: Record<string, string>, cookie: string) {
  return new Request("http://localhost/checkout", {
    method: "POST", body: new URLSearchParams(fields),
    headers: { Cookie: asRequestCookie(cookie) },
  });
}

/** Read input attributes from SSR HTML, as a native form would without hydration. */
function inputs(html: string) {
  return [...html.matchAll(/<input\b[^>]*>/g)].map(([tag]) => ({
    name: /name="([^"]*)"/.exec(tag)?.[1],
    value: (/value="([^"]*)"/.exec(tag)?.[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
    type: /type="([^"]*)"/.exec(tag)?.[1],
    disabled: /\sdisabled(?:[\s=>])/.test(tag),
    checked: /\schecked(?:[\s=>])/.test(tag),
  }));
}

describe("server-rendered forms without JavaScript", () => {
  it("submits the chosen product option from inside the add-to-cart form", async () => {
    const html = await render(new Request("http://localhost/products/aurora-hoodie"));
    const form = /<form\b[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
    const controls = inputs(form);
    const selected = controls.find(input => input.name === "variantId" && input.value.endsWith("/104"));
    expect(selected).toMatchObject({ type: "radio", disabled: false });
    expect(controls.some(input => input.name === "variantId" && input.type === "hidden")).toBe(false);
    const fields = Object.fromEntries(controls.filter(input => input.type === "hidden").map(input => [input.name!, input.value]));
    fields.variantId = selected!.value;
    const response = await cartAction(routeArgs<CartRoute.ActionArgs>(new Request("http://localhost/cart", {
      method: "POST", body: new URLSearchParams(fields),
    })));
    const cookie = new Headers(response.init?.headers).get("Set-Cookie")!;
    const cart = await getCart(new Request("http://localhost/cart", { headers: { Cookie: asRequestCookie(cookie) } }));
    expect(cart.lines[0].variantId).toBe(selected!.value);
    expect(cart.subtotal.amount).toBe("98.00");
  });

  it("renders the changed shipping total for review before creating an order", async () => {
    const cookie = await addToCart(new Request("http://localhost/cart"), "gid://shopify/ProductVariant/101", 1);
    const initial = await render(new Request("http://localhost/checkout", { headers: { Cookie: asRequestCookie(cookie) } }));
    const originalQuote = inputs(initial).find(input => input.name === "quote")!.value;
    expect(initial).toContain("Place order · $89.00");

    const review = await render(post({ ...VALID, shipping: "express", quote: originalQuote }, cookie));
    expect(review).toContain("Place order · $104.00");
    expect(review).toContain("Your order total has been updated.");
    expect(inputs(review).find(input => input.name === "shipping" && input.value === "express")?.checked).toBe(true);
    expect(review).toContain('value="Jane Doe"');

    const quote = inputs(review).find(input => input.name === "quote")!.value;
    const response = await checkoutAction(routeArgs<CheckoutRoute.ActionArgs>(post({ ...VALID, shipping: "express", quote }, cookie)));
    expect(response).toBeInstanceOf(Response);
    const id = (response as Response).headers.get("Location")!.split("/").pop()!;
    expect(getOrder(id)!.total.amount).toBe("104.00");
  });
});

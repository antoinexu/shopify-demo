import { describe, expect, it, vi } from "vitest";
import { createMemoryRouter } from "react-router";
import type { Route } from "./+types/product";
import type { Route as CartRoute } from "./+types/cart";
import { loader, shouldRevalidate } from "./product";
import { action as cartAction } from "./cart";
import { catalog } from "~/lib/catalog.server";
import { routeArgs, statusOfThrown } from "~/lib/test/routes";

/**
 * The handle comes straight out of the URL, which puts this loader one missing
 * null check away from a 500 on a link that has gone stale. The contract is a
 * 404 the ErrorBoundary can render, never a thrown TypeError.
 */

function load(handle: string) {
  return loader(routeArgs<Route.LoaderArgs>(new Request(`http://localhost/products/${handle}`), { handle }));
}

describe("product loader", () => {
  it("loads a product by handle", async () => {
    const { product } = await load("aurora-hoodie");

    expect(product.title).toBe("Aurora Hoodie");
    expect(product.variants.length).toBeGreaterThan(0);
  });

  it("404s on an unknown handle", async () => {
    expect(await statusOfThrown(load("no-such-product"))).toBe(404);
  });

  it("404s on a handle that looks like an injection attempt rather than erroring", async () => {
    expect(await statusOfThrown(load("../../etc/passwd"))).toBe(404);
  });
});

describe("an option that sells out while the page is open", () => {
  const INK_BLACK = "gid://shopify/ProductVariant/104";

  it("reloads the product after the 409, so the option is no longer offered", async () => {
    const router = createMemoryRouter(
      [
        {
          id: "product",
          path: "/products/:handle",
          shouldRevalidate,
          loader: ({ request, params }) =>
            loader(routeArgs<Route.LoaderArgs>(request, { handle: params.handle! })),
        },
        {
          id: "cart",
          path: "/cart",
          action: ({ request }) => cartAction(routeArgs<CartRoute.ActionArgs>(request)),
        },
      ],
      { initialEntries: ["/products/aurora-hoodie"] },
    );
    const variant = () =>
      router.state.loaderData.product.product.variants.find((v: { id: string }) => v.id === INK_BLACK);

    const getProduct = catalog.getProductByHandle.bind(catalog);
    const getVariants = catalog.getVariantsByIds.bind(catalog);
    const soldOut = <T extends { id: string; availableForSale: boolean }>(v: T): T =>
      v.id === INK_BLACK ? { ...v, availableForSale: false } : v;
    const productSpy = vi.spyOn(catalog, "getProductByHandle");
    const variantsSpy = vi.spyOn(catalog, "getVariantsByIds");
    try {
      await router.initialize();
      if (!router.state.initialized) {
        await new Promise<void>((done) => {
          const stop = router.subscribe((state) => state.initialized && (stop(), done()));
        });
      }
      expect(variant().availableForSale).toBe(true);

      // Sells out after the page rendered
      productSpy.mockImplementation(async (handle) => {
        const product = await getProduct(handle);
        return product && { ...product, variants: product.variants.map(soldOut) };
      });
      variantsSpy.mockImplementation(async (ids) => (await getVariants(ids)).map(soldOut));

      const form = new FormData();
      form.set("intent", "add");
      form.set("variantId", INK_BLACK);
      form.set("quantity", "1");
      // Read the result inside the subscription: once idle, a fetcher no component
      // is subscribed to is dropped from router state along with its data
      let result: unknown;
      await new Promise<void>((done) => {
        const stop = router.subscribe((state) => {
          const fetcher = state.fetchers.get("add");
          if (fetcher?.data !== undefined) result = fetcher.data;
          if (fetcher?.state === "idle" && state.revalidation === "idle") {
            stop();
            done();
          }
        });
        router.fetch("add", "product", "/cart", { formMethod: "post", formData: form });
      });

      expect(result).toMatchObject({ ok: false, code: "SOLD_OUT" });
      // Without shouldRevalidate the loader data would still say true
      expect(variant().availableForSale).toBe(false);
    } finally {
      productSpy.mockRestore();
      variantsSpy.mockRestore();
      router.dispose();
    }
  });
});

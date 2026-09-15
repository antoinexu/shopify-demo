import { describe, expect, it } from "vitest";
import type { Route as ProductRoute } from "./+types/product";
import type { Route as OrderRoute } from "./+types/order";
import { loader as productLoader } from "./product";
import { loader as orderLoader } from "./order";

/**
 * Both of these loaders take an id straight out of the URL, which means both are
 * one missing null check away from a 500 on a link that has gone stale. The
 * contract is a 404 the ErrorBoundary can render, never a thrown TypeError.
 */

function args<T>(params: Record<string, string>, url: string) {
  return { request: new Request(url), params, context: {} } as unknown as T;
}

async function statusOfThrown(promise: Promise<unknown>): Promise<number> {
  const thrown = await promise.catch((error) => error);
  expect(thrown, "the loader must throw a Response, not a plain Error").toBeInstanceOf(Response);
  return (thrown as Response).status;
}

describe("product loader", () => {
  it("loads a product by handle", async () => {
    const { product } = await productLoader(
      args<ProductRoute.LoaderArgs>({ handle: "aurora-hoodie" }, "http://localhost/products/aurora-hoodie"),
    );

    expect(product.title).toBe("Aurora Hoodie");
    expect(product.variants.length).toBeGreaterThan(0);
  });

  it("404s on an unknown handle", async () => {
    const status = await statusOfThrown(
      productLoader(args<ProductRoute.LoaderArgs>({ handle: "no-such-product" }, "http://localhost/products/no-such-product")),
    );
    expect(status).toBe(404);
  });

  it("404s on a handle that looks like an injection attempt rather than erroring", async () => {
    const status = await statusOfThrown(
      productLoader(args<ProductRoute.LoaderArgs>({ handle: "../../etc/passwd" }, "http://localhost/products/x")),
    );
    expect(status).toBe(404);
  });
});

describe("order loader", () => {
  it("404s on an id that was never issued", async () => {
    const status = await statusOfThrown(
      orderLoader(args<OrderRoute.LoaderArgs>({ id: "0".repeat(32) }, "http://localhost/orders/x")),
    );
    expect(status).toBe(404);
  });

  it("404s on an empty id rather than returning someone else's order", async () => {
    const status = await statusOfThrown(
      orderLoader(args<OrderRoute.LoaderArgs>({ id: "" }, "http://localhost/orders/")),
    );
    expect(status).toBe(404);
  });
});

import { describe, expect, it } from "vitest";
import type { Route } from "./+types/product";
import { loader } from "./product";
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

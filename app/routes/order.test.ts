import { describe, expect, it } from "vitest";
import type { Route } from "./+types/order";
import { loader } from "./order";
import { loaderArgs, statusOfThrown } from "~/lib/test/route-args";

/**
 * The order id is both the lookup key and the only thing protecting the order,
 * so an id that was never issued must read as "not found" — never as an empty
 * page, and never as someone else's order.
 */

function load(id: string) {
  return loader(loaderArgs<Route.LoaderArgs>({ id }, `http://localhost/orders/${id}`));
}

describe("order loader", () => {
  it("404s on an id that was never issued", async () => {
    expect(await statusOfThrown(load("0".repeat(32)))).toBe(404);
  });

  it("404s on an empty id rather than returning someone else's order", async () => {
    expect(await statusOfThrown(load(""))).toBe(404);
  });
});

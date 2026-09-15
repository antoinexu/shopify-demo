import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogAdapter } from "./types";

/**
 * The adapter is the migration-critical seam: everything the storefront renders
 * about a live store passes through its normalization. These tests drive it with
 * a stubbed fetch, focusing on the shapes a real Shopify response actually
 * produces — nullable fields, missing images, deleted variants, paged results.
 */

const BASE_ENV = {
  SHOPIFY_STORE_DOMAIN: "test-store.myshopify.com",
  SHOPIFY_STOREFRONT_TOKEN: "test-token",
  SHOPIFY_API_VERSION: "2026-07",
};

const SAVED_ENV = { ...process.env };

/** Config is cached per module instance, so each case needs a fresh import. */
async function loadAdapter(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { shopifyCatalog } = await import("./shopify.server");
  return shopifyCatalog as CatalogAdapter;
}

const money = (amount: string) => ({ amount, currencyCode: "EUR" });

function rawProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/Product/1",
    handle: "jacket",
    title: "Jacket",
    description: "A jacket.",
    priceRange: { minVariantPrice: money("120.00") },
    images: { nodes: [{ url: "https://cdn.example/x.jpg", altText: "Alt text" }] },
    variants: {
      nodes: [{ id: "gid://shopify/ProductVariant/11", title: "M", availableForSale: true, price: money("120.00") }],
    },
    ...overrides,
  };
}

/** Queues one JSON body per fetch call, in order. */
function mockFetch(...bodies: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env = { ...SAVED_ENV };
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...SAVED_ENV };
});

describe("configuration", () => {
  it("names the missing variables instead of failing obscurely", async () => {
    const adapter = await loadAdapter({ SHOPIFY_STOREFRONT_TOKEN: undefined });
    await expect(adapter.getProducts()).rejects.toThrow(/SHOPIFY_STOREFRONT_TOKEN/);
  });

  it("rejects a non-numeric timeout rather than silently disabling it", async () => {
    const adapter = await loadAdapter({ SHOPIFY_TIMEOUT_MS: "soon" });
    await expect(adapter.getProducts()).rejects.toThrow(/SHOPIFY_TIMEOUT_MS/);
  });
});

describe("request shape", () => {
  it("posts to the versioned endpoint with the storefront token", async () => {
    const fetchMock = mockFetch({
      data: { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    });
    const adapter = await loadAdapter();
    await adapter.getProducts();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test-store.myshopify.com/api/2026-07/graphql.json");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Shopify-Storefront-Access-Token"]).toBe("test-token");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("normalization", () => {
  it("falls back to the product title when altText is null", async () => {
    mockFetch({
      data: {
        products: {
          nodes: [rawProduct({ images: { nodes: [{ url: "https://cdn.example/x.jpg", altText: null }] } })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
    const [product] = await (await loadAdapter()).getProducts();
    expect(product.images[0].altText).toBe("Jacket");
  });

  it("substitutes a placeholder for a product with no images", async () => {
    mockFetch({
      data: {
        products: {
          nodes: [rawProduct({ images: { nodes: [] } })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
    const [product] = await (await loadAdapter()).getProducts();
    // Components index images[0] directly, so this must never be empty
    expect(product.images).toHaveLength(1);
    expect(product.images[0].url).toBe("/images/placeholder.svg");
  });

  it("turns a null description into an empty string", async () => {
    mockFetch({
      data: {
        products: {
          nodes: [rawProduct({ description: null })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
    const [product] = await (await loadAdapter()).getProducts();
    expect(product.description).toBe("");
  });

  it("carries the currency through from the API rather than assuming one", async () => {
    mockFetch({
      data: {
        products: {
          nodes: [rawProduct()],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
    const [product] = await (await loadAdapter()).getProducts();
    expect(product.priceRange.minVariantPrice.currencyCode).toBe("EUR");
  });
});

describe("pagination", () => {
  it("walks every page instead of truncating at the first", async () => {
    const fetchMock = mockFetch(
      {
        data: {
          products: {
            nodes: [rawProduct({ handle: "page1-a" }), rawProduct({ handle: "page1-b" })],
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          },
        },
      },
      {
        data: {
          products: {
            nodes: [rawProduct({ handle: "page2-a" })],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    );

    const products = await (await loadAdapter()).getProducts();

    expect(products.map((p) => p.handle)).toEqual(["page1-a", "page1-b", "page2-a"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second request must carry the cursor, or it just refetches page one forever
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables.after).toBe("cursor-1");
  });

  it("throws rather than looping forever when hasNextPage never goes false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: {
          products: { nodes: [rawProduct()], pageInfo: { hasNextPage: true, endCursor: "c" } },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect((await loadAdapter()).getProducts()).rejects.toThrow(/more than/);
  });
});

describe("getVariantsByIds", () => {
  it("resolves the whole cart in one request", async () => {
    const fetchMock = mockFetch({
      data: {
        nodes: [
          { id: "gid://shopify/ProductVariant/11", title: "M", availableForSale: true, price: money("120.00"), product: rawProduct() },
          { id: "gid://shopify/ProductVariant/12", title: "L", availableForSale: true, price: money("130.00"), product: rawProduct() },
        ],
      },
    });

    const variants = await (await loadAdapter()).getVariantsByIds([
      "gid://shopify/ProductVariant/11",
      "gid://shopify/ProductVariant/12",
    ]);

    expect(variants).toHaveLength(2);
    // One round trip for two ids — the whole point of the batched contract
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops ids that no longer resolve, e.g. a variant deleted since add-to-cart", async () => {
    mockFetch({
      data: {
        nodes: [
          { id: "gid://shopify/ProductVariant/11", title: "M", availableForSale: true, price: money("120.00"), product: rawProduct() },
          null,
        ],
      },
    });

    const variants = await (await loadAdapter()).getVariantsByIds([
      "gid://shopify/ProductVariant/11",
      "gid://shopify/ProductVariant/deleted",
    ]);

    expect(variants).toHaveLength(1);
    expect(variants[0].id).toBe("gid://shopify/ProductVariant/11");
  });

  it("skips the network entirely for an empty cart", async () => {
    const fetchMock = mockFetch();
    const variants = await (await loadAdapter()).getVariantsByIds([]);
    expect(variants).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("failure modes", () => {
  it("reports the status on an HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) }),
    );
    await expect((await loadAdapter()).getProducts()).rejects.toThrow(/401 Unauthorized/);
  });

  it("surfaces GraphQL errors that arrive inside a 200 response", async () => {
    mockFetch({ errors: [{ message: "Field 'nope' doesn't exist" }] });
    await expect((await loadAdapter()).getProducts()).rejects.toThrow(/doesn't exist/);
  });

  it("converts a timeout into a message that names the limit", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
    const adapter = await loadAdapter({ SHOPIFY_TIMEOUT_MS: "1234" });
    await expect(adapter.getProducts()).rejects.toThrow(/timed out after 1234ms/);
  });

  it("names the endpoint when the host is unreachable, since a typo is the usual cause", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")));
    await expect((await loadAdapter()).getProducts()).rejects.toThrow(/unreachable at https:\/\/test-store/);
  });
});

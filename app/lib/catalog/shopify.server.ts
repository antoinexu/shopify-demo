/**
 * Live Shopify Storefront API adapter.
 *
 * Point this at a migrated store and the whole storefront becomes a verification
 * harness: if the product grid, variant picker, prices and availability all render
 * correctly, the catalog half of the migration landed.
 *
 * Only ever loaded when CATALOG_SOURCE=shopify — see ../catalog.server.ts.
 */

import {
  PLACEHOLDER_IMAGE,
  type CatalogAdapter,
  type Product,
  type VariantWithProduct,
} from "./types";

/* ---------------- Configuration ---------------- */

type StorefrontConfig = {
  domain: string;
  token: string;
  apiVersion: string;
  endpoint: string;
  timeoutMs: number;
};

/** A page of products per round trip. 250 is the Storefront ceiling. */
const PAGE_SIZE = 100;

/**
 * Hard stop on pagination. A catalog larger than this is legitimate, but looping
 * forever against a misbehaving API is not — the adapter throws instead, so the
 * failure is loud rather than a hung request.
 */
const MAX_PAGES = 50;

/**
 * Read lazily rather than at module load, so an accidental import in mock mode
 * cannot crash the server.
 */
function readConfig(): StorefrontConfig {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
  // Shopify ships a new API version quarterly and supports each for a year.
  // Check the current supported set before pinning: https://shopify.dev/docs/api/usage/versioning
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2026-07";
  const timeoutMs = Number(process.env.SHOPIFY_TIMEOUT_MS ?? 8000);

  const missing = [
    !domain && "SHOPIFY_STORE_DOMAIN",
    !token && "SHOPIFY_STOREFRONT_TOKEN",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `CATALOG_SOURCE=shopify requires ${missing.join(" and ")}. ` +
        `Copy .env.example to .env and fill them in, or unset CATALOG_SOURCE to use mock data.`,
    );
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`SHOPIFY_TIMEOUT_MS must be a positive number, got "${process.env.SHOPIFY_TIMEOUT_MS}"`);
  }

  return {
    domain: domain!,
    token: token!,
    apiVersion,
    timeoutMs,
    endpoint: `https://${domain}/api/${apiVersion}/graphql.json`,
  };
}

let cached: StorefrontConfig | null = null;
function config(): StorefrontConfig {
  return (cached ??= readConfig());
}

/* ---------------- Transport ---------------- */

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

async function storefront<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { endpoint, token, timeoutMs } = config();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      // Without this a hung connection hangs the request forever: no timeout,
      // no retry, one stuck upstream takes the whole page down with it.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`Storefront API timed out after ${timeoutMs}ms (${endpoint})`);
    }
    // DNS failure, refused connection, TLS error — surface the endpoint, since
    // a typo in SHOPIFY_STORE_DOMAIN is the usual cause.
    throw new Error(`Storefront API unreachable at ${endpoint}: ${(error as Error).message}`);
  }

  if (!response.ok) {
    // 401/403 almost always means a wrong token or one lacking unauthenticated_read_product_listings
    throw new Error(`Storefront API ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as GraphQLResponse<T>;

  // GraphQL reports field-level failures in a 200 response, so this must be checked separately
  if (body.errors?.length) {
    throw new Error(`Storefront API: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) {
    throw new Error("Storefront API returned no data");
  }

  return body.data;
}

/* ---------------- Queries ---------------- */

/**
 * variants(first: 250) is the page ceiling. Shopify caps a product at 3 option
 * dimensions, and products that exceed the variant ceiling need pagination —
 * exactly the products an OpenCart import is most likely to produce, so a real
 * migration should log them rather than silently truncate.
 */
const PRODUCT_FIELDS = `#graphql
  fragment ProductFields on Product {
    id
    handle
    title
    description
    priceRange { minVariantPrice { amount currencyCode } }
    images(first: 5) { nodes { url altText } }
    variants(first: 250) {
      nodes { id title availableForSale price { amount currencyCode } }
    }
  }
`;

const PRODUCTS_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      nodes { ...ProductFields }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query ProductByHandle($handle: String!) {
    product(handle: $handle) { ...ProductFields }
  }
`;

const VARIANTS_BY_IDS_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query VariantsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        availableForSale
        price { amount currencyCode }
        product { ...ProductFields }
      }
    }
  }
`;

/* ---------------- Response shapes + normalization ---------------- */

type RawMoney = { amount: string; currencyCode: string };

type RawProduct = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  priceRange: { minVariantPrice: RawMoney };
  images: { nodes: { url: string; altText: string | null }[] };
  variants: {
    nodes: { id: string; title: string; availableForSale: boolean; price: RawMoney }[];
  };
};

type ProductsPage = {
  products: {
    nodes: RawProduct[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type RawVariantNode = {
  id: string;
  title: string;
  availableForSale: boolean;
  price: RawMoney;
  product: RawProduct;
} | null;

/**
 * Shopify makes description, altText and images optional; the UI does not.
 * Normalizing here is what keeps every component free of null checks.
 */
function toProduct(raw: RawProduct): Product {
  const images = raw.images.nodes.map((image) => ({
    url: image.url,
    altText: image.altText ?? raw.title,
  }));

  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    description: raw.description ?? "",
    priceRange: raw.priceRange,
    // Components index images[0] directly, so never hand them an empty array
    images: images.length > 0 ? images : [PLACEHOLDER_IMAGE],
    variants: raw.variants.nodes,
  };
}

/* ---------------- Adapter ---------------- */

export const shopifyCatalog: CatalogAdapter = {
  name: "shopify",

  /**
   * Walks every page rather than taking the first N.
   *
   * This matters most when the app is used to verify a migration: a single-page
   * fetch renders 100 products from a store that holds 800, everything looks
   * right, and the missing 700 are never noticed. Silently truncating is worse
   * than failing.
   */
  async getProducts() {
    const products: Product[] = [];
    let after: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const data: ProductsPage = await storefront<ProductsPage>(PRODUCTS_QUERY, {
        first: PAGE_SIZE,
        after,
      });

      products.push(...data.products.nodes.map(toProduct));

      if (!data.products.pageInfo.hasNextPage) return products;
      after = data.products.pageInfo.endCursor;
    }

    throw new Error(
      `Storefront API returned more than ${MAX_PAGES * PAGE_SIZE} products. ` +
        `Raise MAX_PAGES, or page the catalog lazily instead of loading it all at once.`,
    );
  },

  async getProductByHandle(handle) {
    const data = await storefront<{ product: RawProduct | null }>(PRODUCT_BY_HANDLE_QUERY, {
      handle,
    });
    return data.product ? toProduct(data.product) : null;
  },

  async getVariantsByIds(variantIds) {
    if (variantIds.length === 0) return [];

    const data = await storefront<{ nodes: RawVariantNode[] }>(VARIANTS_BY_IDS_QUERY, {
      ids: variantIds,
    });

    const found: VariantWithProduct[] = [];
    for (const node of data.nodes) {
      // nodes() returns null for ids that no longer resolve — a variant deleted
      // since it was added to someone's cart. Dropping it matches the mock behavior.
      if (!node) continue;
      found.push({
        id: node.id,
        title: node.title,
        availableForSale: node.availableForSale,
        price: node.price,
        product: toProduct(node.product),
      });
    }
    return found;
  },
};

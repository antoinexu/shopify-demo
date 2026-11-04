# shopify-demo

A Shopify-style storefront demo built with **React Router v7** (framework mode, SSR):
product list → product detail → cart → checkout → order confirmation, end to end.

The catalog is **pluggable**: it runs on in-memory fixtures by default, or against a
live Shopify Storefront API by setting one environment variable. The data shapes mirror
the Storefront API throughout, which is what makes the two interchangeable.

In Shopify terms this is a **headless** storefront: the pages are this app's own React
code rather than a Shopify theme, and only the data comes from Shopify. Today that covers
the catalog; the cart and orders are still local (see
[Wiring up real Shopify](#wiring-up-real-shopify)).

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

Other commands:

```bash
npm run build        # emits build/client and build/server
npm start            # serves the build in production mode
npm run typecheck    # react-router typegen && tsc --noEmit
npm test             # vitest, single run
npm run test:watch   # vitest in watch mode
```

Requires Node 20+ (the code uses the global `crypto.randomUUID`).

## Environment

Copy `.env.example` to `.env`:

| Variable | Purpose |
| --- | --- |
| `CATALOG_SOURCE` | `mock` (default) or `shopify` |
| `SHOPIFY_STORE_DOMAIN` | Required for `shopify`. The permanent `*.myshopify.com` domain |
| `SHOPIFY_STOREFRONT_TOKEN` | Required for `shopify`. Needs `unauthenticated_read_product_listings` |
| `SHOPIFY_API_VERSION` | Optional, defaults to a recent version. Check Shopify version support before pinning |
| `SHOPIFY_TIMEOUT_MS` | Optional per-request timeout, default `8000` |
| `SESSION_SECRET` | Signing key for the cart cookie. Optional in development; **required in production — the server refuses to boot without it** |

### Switching the catalog source

```bash
npm run dev                                  # mock fixtures, zero config
CATALOG_SOURCE=shopify npm run dev           # live Storefront API
```

The footer always shows which backend served the page, so you never have to guess
whether you are looking at fixtures or the real store.

## Project layout

```
app/
├── lib/
│   ├── catalog.server.ts   # Source switch: picks an adapter from CATALOG_SOURCE
│   ├── catalog/
│   │   ├── types.ts        # Catalog types, the CatalogAdapter contract, toProductSummary (client-safe)
│   │   ├── mock.server.ts  # In-memory fixtures (default)
│   │   └── shopify.server.ts  # Live Storefront API adapter
│   ├── money.ts            # Money type, formatMoney, integer-cent arithmetic (client-safe)
│   ├── cart.server.ts      # Cart: cookie session read/write, pricing
│   ├── cart.ts             # Cart rules shared with the UI: MAX_QUANTITY, clampQuantity
│   ├── orders.server.ts    # Orders: in-memory store, order creation, form validation (server only)
│   ├── shipping.ts         # Shipping methods / US states / address type (client needs these, hence no .server)
│   └── test/routes.ts      # Test helpers for calling loaders and actions directly
├── components/             # Stateless presentational components
├── routes/                 # One file per route, each with its loader / action
├── routes.ts               # Route table
├── root.tsx                # HTML shell + global header + ErrorBoundary
└── styles/app.css          # All styles, single file, no CSS framework
```

## Routes

| Path | File | Purpose |
| --- | --- | --- |
| `/` | `routes/home.tsx` | Product list |
| `/products/:handle` | `routes/product.tsx` | Product detail, variant picker, add to cart |
| `/cart` | `routes/cart.tsx` | Cart page; **also the action endpoint for every cart write in the app** |
| `/checkout` | `routes/checkout.tsx` | Checkout form, validated server-side |
| `/orders/:id` | `routes/order.tsx` | Order confirmation |

## Key design decisions

**Cart lines store only `variantId` + `quantity`.** Prices are always recomputed on the
server from current product data (`getCart` in `cart.server.ts`), so whatever price the
client sends is ignored. Deleted variants block checkout until the customer opens
the cart, where they are removed with a notice. On cart and checkout the header badge
reuses the count those pages already resolved, so the catalog is never queried twice
for one page. Cookie carts allow up to 30 different options, with a
serialized-size check and a recoverable error when full.

**Checkout is idempotent within one server process.** Every cart write assigns a
random checkout identity in the signed cookie. Concurrent submissions and retries
of that revision return the same order. The identity-to-order mapping lives beside
the in-memory orders; a production implementation needs shared persistent storage
with a unique constraint.

**A changed quote needs confirmation.** The form describes the displayed items,
prices, quantities and shipping method. The action compares it with current catalog
data before creating an order. A changed price or a shipping selection made without
JavaScript returns an updated summary for confirmation. Submitted quotes never set
order prices.

**Money is arithmetic in integer cents.** Shopify sends amounts as decimal strings;
`lib/money.ts` converts them to cents, does the sums there, and converts back only for
display. The checkout summary uses the same functions as `createOrder`, so the total on
the button is the total the order records. A cart that mixes currencies throws rather
than adding them up.

**Every cart write posts to the `/cart` action**, distinguished by a hidden `intent`
field (`add` / `update` / `remove` / `clear`). The add-to-cart button lives on the
product page but its form targets `action="/cart"`, so the detail route needs no action
of its own.

**Progressive enhancement.** Add-to-cart and quantity changes submit through
`useFetcher`, so the page never navigates. With JavaScript disabled they degrade to
plain form POSTs and still work.
Product option radios belong to the add-to-cart form, so native submissions carry
the selected option without relying on a hidden value updated by JavaScript.

**The `.server` suffix is load-bearing.** React Router only strips server code from
`loader` / `action` / `middleware` / `headers`. The moment a component (or a module's
top level) imports a `*.server.ts`, the whole module lands in the client bundle and the
build fails. That is why `SHIPPING_METHODS` and `US_STATES`, which the checkout form
renders, live in `lib/shipping.ts` rather than `lib/orders.server.ts`.

**The order id is the access credential.** The order page has no auth — holding the
link is enough to view the order, the same idea as Shopify's order status URL. That is
why the id comes from `crypto.randomUUID()` and never from `Math.random()`.

## Wiring up real Shopify

1. **Catalog — done.** `CATALOG_SOURCE=shopify` switches `lib/catalog.server.ts` over to
   the Storefront adapter. Adding another source (a CSV export, a staging store) means
   writing one more `CatalogAdapter`.
2. **`app/lib/cart.server.ts`** — still local. Replace with the Storefront `cartCreate` /
   `cartLinesAdd` mutations, keeping only the Shopify cart id in the cookie.
3. **`app/lib/orders.server.ts`** — still local. Redirect checkout to the `checkoutUrl`
   Shopify returns and let Shopify host payment; delete the in-memory `Map` entirely.

## Tests

```bash
npm test
```

No network and no browser. The weight sits where correctness is hardest to eyeball:

| File | Covers |
| --- | --- |
| `lib/catalog/shopify.test.ts` | The Storefront adapter against a stubbed fetch: request shape, normalization of nullable fields, cursor pagination, batching, timeouts, HTTP and GraphQL errors |
| `lib/cart.test.ts` | Cart writes through a real cookie round trip: quantity clamping, merge on re-add, delete at zero, server-side pricing |
| `lib/orders.test.ts` | Checkout validation, field by field, with the US phone and ZIP formats spelled out |
| `lib/money.test.ts` | Money formatting across currencies (including a zero-decimal one) and the cents round trip |
| `lib/shipping.test.ts` | State table integrity and shipping method lookup |
| `lib/catalog/types.test.ts` | `toProductSummary`: what the home payload keeps, drops, and how sold-out is derived |
| `routes/cart.test.ts` | The `/cart` action's intent dispatch, unknown-variant rejection, and the cookie it returns |
| `routes/checkout.test.ts` | Empty-cart redirect, server pricing, quote confirmation, idempotent submissions, deleted products, mixed cart problems, shipping and validation |
| `routes/forms.test.ts` | SSR form structure and native option submission; no-JS shipping review and confirmation |
| `routes/product.test.ts` | Product loader by handle and its 404s |
| `routes/order.test.ts` | Order loader 404s for ids that were never issued |

Route tests call the loader or action directly through the helpers in `lib/test/routes.ts`.

## Known limitations

- **Orders live in an in-process `Map`.** Restarting the server (including a dev-mode
  hot reload) loses them, and they are invisible to other instances. Demo only.
- **Concurrent cart writes clobber each other.** The cookie session is a read → modify →
  write-everything-back cycle, so rapidly clicking +/− on different lines lets the later
  response overwrite the earlier one. A real implementation would hold a cart id
  server-side.
- **The cents scale is fixed at 100.** Zero-decimal currencies such as JPY still display
  correctly, but a store using them, or a three-decimal one, should scale per currency.
- **Availability is a yes/no flag, not a stock count.** The `/cart` action refuses a
  sold-out variant and checkout rechecks every line before creating the order, but both
  read `availableForSale` only. Nothing reserves stock, so two customers can still buy
  the last unit in the same moment.
- **No real payment integration** — submitting checkout creates the order directly.
- **US-only addressing.** State is a 50-state + DC dropdown, ZIP accepts `12345` or
  `12345-6789`, and phone validation expects a 10-digit North American number.
- **The Storefront adapter has not been run against a real store.** It is covered by
  unit tests and by a local stub reproducing the documented response shape — null
  `altText`, null `description`, imageless products, deleted variants, paged results,
  timeouts. Treat the first run against a live store as the real test.
- **A product with more than 250 variants is truncated.** `getProducts` pages through
  the whole catalog, but the variant list inside each product is a single page. A catalog
  with products that large should page the variants or log the overflow.
- **Outside cart and checkout, the header badge reads the cookie without a catalog
  lookup.** It can include recently delisted lines until the cart is opened, which
  removes those lines from the cookie and corrects the count on that visit.
- No lint configuration.

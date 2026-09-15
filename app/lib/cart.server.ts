import { createCookieSessionStorage } from "react-router";
import { getVariantsByIds } from "./catalog.server";
import type { Money, VariantWithProduct } from "./catalog/types";

/**
 * The cart stores only variantId + quantity. Prices are always recomputed on the
 * server from current product data, so the client cannot tamper with them.
 */
export type CartItem = {
  variantId: string;
  quantity: number;
};

export type CartLine = {
  variantId: string;
  quantity: number;
  variant: VariantWithProduct;
  lineTotal: Money;
};

export type Cart = {
  lines: CartLine[];
  totalQuantity: number;
  subtotal: Money;
};

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * A hardcoded fallback is fine for local development and unacceptable in
 * production: this repo is public, so the fallback value is public too. Fail at
 * boot rather than silently signing cookies with a key anyone can read.
 */
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;

  if (IS_PRODUCTION) {
    throw new Error(
      "SESSION_SECRET must be set in production. " +
        'Generate one with: node -e "console.log(crypto.randomUUID())"',
    );
  }

  return "shopify-demo-dev-secret";
}

const { getSession, commitSession } = createCookieSessionStorage<{ items: CartItem[] }>({
  cookie: {
    name: "__cart",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    secrets: [sessionSecret()],
    secure: IS_PRODUCTION,
  },
});

const MAX_QUANTITY = 99;

function clamp(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(Math.max(Math.trunc(quantity), 0), MAX_QUANTITY);
}

async function readItems(request: Request): Promise<CartItem[]> {
  const session = await getSession(request.headers.get("Cookie"));
  return session.get("items") ?? [];
}

async function writeItems(request: Request, items: CartItem[]): Promise<string> {
  const session = await getSession(request.headers.get("Cookie"));
  session.set("items", items);
  return commitSession(session);
}

/**
 * Item count straight from the cookie, with no catalog lookup.
 *
 * The root loader renders the header badge on *every* page, so resolving
 * variants here would mean a Storefront round trip on pages that show no
 * products at all — the order confirmation page, for instance.
 *
 * The trade-off: this counts lines whose variant has since been delisted, which
 * getCart drops. The number self-corrects as soon as the customer opens the cart.
 */
export async function getCartQuantity(request: Request): Promise<number> {
  const items = await readItems(request);
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Expands stored variant ids into full product data and computes line totals. */
export async function getCart(request: Request): Promise<Cart> {
  const items = await readItems(request);

  // One batched lookup for the whole cart. Resolving variants one at a time is
  // harmless against mock data and an N+1 against a live Storefront API.
  const variants = await getVariantsByIds(items.map((item) => item.variantId));
  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const lines: CartLine[] = [];
  for (const item of items) {
    const variant = byId.get(item.variantId);
    // Skip stale entries for delisted products instead of blowing up the page
    if (!variant) continue;

    const lineTotal = Number(variant.price.amount) * item.quantity;
    lines.push({
      variantId: item.variantId,
      quantity: item.quantity,
      variant,
      lineTotal: { amount: lineTotal.toFixed(2), currencyCode: variant.price.currencyCode },
    });
  }

  const subtotalAmount = lines.reduce((sum, line) => sum + Number(line.lineTotal.amount), 0);

  return {
    lines,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: {
      amount: subtotalAmount.toFixed(2),
      currencyCode: lines[0]?.lineTotal.currencyCode ?? "USD",
    },
  };
}

export async function addToCart(request: Request, variantId: string, quantity: number) {
  const items = await readItems(request);
  const amount = clamp(quantity) || 1;
  const existing = items.find((item) => item.variantId === variantId);

  if (existing) {
    existing.quantity = clamp(existing.quantity + amount);
  } else {
    items.push({ variantId, quantity: amount });
  }

  return writeItems(request, items);
}

export async function updateCartLine(request: Request, variantId: string, quantity: number) {
  const items = await readItems(request);
  const amount = clamp(quantity);
  const next =
    amount === 0
      ? items.filter((item) => item.variantId !== variantId)
      : items.map((item) => (item.variantId === variantId ? { ...item, quantity: amount } : item));

  return writeItems(request, next);
}

export async function removeCartLine(request: Request, variantId: string) {
  const items = await readItems(request);
  return writeItems(request, items.filter((item) => item.variantId !== variantId));
}

export async function clearCart(request: Request) {
  return writeItems(request, []);
}

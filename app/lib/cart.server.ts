import { createCookieSessionStorage } from "react-router";
import { getVariantsByIds } from "./catalog.server";
import { clampQuantity, MAX_CART_LINES } from "./cart";
import type { VariantWithProduct } from "./catalog/types";
import { fromMinorUnits, toMinorUnits, type Money } from "./money";

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
  missingItems: CartItem[];
  totalQuantity: number;
  subtotal: Money;
};

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** Only ever used for the subtotal of an empty cart, which has no line to take a currency from. */
const DEFAULT_CURRENCY = "USD";

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

const { getSession, commitSession } = createCookieSessionStorage<{ items: CartItem[]; checkoutId: string }>({
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

async function readItems(request: Request): Promise<CartItem[]> {
  const session = await getSession(request.headers.get("Cookie"));
  return session.get("items") ?? [];
}

async function writeItems(request: Request, items: CartItem[]): Promise<string> {
  const session = await getSession(request.headers.get("Cookie"));
  session.set("items", items);
  // Every cart revision can be checked out once. Keep this in the signed cookie,
  // rather than accepting an idempotency key supplied by the form.
  session.set("checkoutId", crypto.randomUUID());
  try {
    return await commitSession(session);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cookie length will exceed")) {
      throw new CartCapacityError();
    }
    throw error;
  }
}

export class CartCapacityError extends Error {
  constructor() {
    super(`Your cart is full. Remove an item before adding another (up to ${MAX_CART_LINES} different options).`);
  }
}

export async function getCheckoutId(request: Request): Promise<string | undefined> {
  return (await getSession(request.headers.get("Cookie"))).get("checkoutId");
}

/** Called after the customer has opened the cart and can review the removals. */
export async function removeMissingItems(request: Request, cart: Cart): Promise<string> {
  return writeItems(request, cart.lines.map(({ variantId, quantity }) => ({ variantId, quantity })));
}

/**
 * Item count straight from the cookie, with no catalog lookup.
 *
 * The root loader renders the header badge on *every* page, so resolving
 * variants here would mean a Storefront round trip on pages that show no
 * products at all — the order confirmation page, for instance.
 *
 * On cart and checkout the Layout shows those pages' resolved count instead, so
 * the badge never disagrees with the lines on screen. Opening the cart removes
 * stale cookie entries, after which this count is exact again.
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
  const missingItems: CartItem[] = [];
  for (const item of items) {
    const variant = byId.get(item.variantId);
    if (!variant) {
      missingItems.push(item);
      continue;
    }

    // Integer cents throughout: see toMinorUnits for what floats get wrong here
    const lineTotal = toMinorUnits(variant.price.amount) * item.quantity;
    lines.push({
      variantId: item.variantId,
      quantity: item.quantity,
      variant,
      lineTotal: fromMinorUnits(lineTotal, variant.price.currencyCode),
    });
  }

  const currency = lines[0]?.lineTotal.currencyCode ?? DEFAULT_CURRENCY;

  // Summing across currencies produces a number that is simply wrong while still
  // looking plausible, so refuse rather than render it. A Storefront API context
  // serves one currency, which makes this an impossible-state guard: if it ever
  // fires, something upstream is mixing two stores.
  const foreign = lines.find((line) => line.lineTotal.currencyCode !== currency);
  if (foreign) {
    throw new Error(
      `Cart mixes currencies (${currency} and ${foreign.lineTotal.currencyCode}); refusing to total it.`,
    );
  }

  const subtotal = lines.reduce((sum, line) => sum + toMinorUnits(line.lineTotal.amount), 0);

  return {
    lines,
    missingItems,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: fromMinorUnits(subtotal, currency),
  };
}

export async function addToCart(request: Request, variantId: string, quantity: number) {
  const items = await readItems(request);
  const amount = clampQuantity(quantity) || 1;
  const existing = items.find((item) => item.variantId === variantId);

  if (existing) {
    existing.quantity = clampQuantity(existing.quantity + amount);
  } else {
    if (items.length >= MAX_CART_LINES) throw new CartCapacityError();
    items.push({ variantId, quantity: amount });
  }

  return writeItems(request, items);
}

export async function updateCartLine(request: Request, variantId: string, quantity: number) {
  const items = await readItems(request);
  const amount = clampQuantity(quantity);
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

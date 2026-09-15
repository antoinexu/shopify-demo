import type { Cart } from "./cart.server";
import {
  getShippingMethod,
  isValidStateCode,
  type ShippingAddress,
  type ShippingMethod,
} from "./shipping";
import type { Money } from "./catalog/types";

/**
 * Mock order store.
 *
 * An in-process Map — restart the server and the orders are gone. Good enough
 * for a demo. Wiring up real Shopify would replace this with cartCreate +
 * checkoutUrl, or a table in your own backend.
 */

export type OrderLine = {
  title: string;
  variantTitle: string;
  handle: string;
  imageUrl: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
};

export type Order = {
  /** Unguessable id used in the URL — holding the link is enough to view the order, same idea as Shopify's order status URL */
  id: string;
  /** The human-readable order number */
  number: string;
  createdAt: string;
  address: ShippingAddress;
  shipping: ShippingMethod;
  lines: OrderLine[];
  subtotal: Money;
  shippingFee: Money;
  total: Money;
};

const ORDERS = new Map<string, Order>();

function money(amount: number, currencyCode: string): Money {
  return { amount: amount.toFixed(2), currencyCode };
}

/**
 * The order id doubles as the access credential — the order page has no auth,
 * so anyone with the link can view it. That makes a cryptographically secure
 * random source mandatory; Math.random() is predictable and must never be used here.
 */
function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function orderNumber(date: Date): string {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  // Display-only sequence number; carries no security weight, so Math.random is fine
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `MRD-${stamp}-${suffix}`;
}

export function createOrder(cart: Cart, address: ShippingAddress, shipping: ShippingMethod): Order {
  const currency = cart.subtotal.currencyCode;
  const subtotal = Number(cart.subtotal.amount);
  const now = new Date();

  const order: Order = {
    id: randomId(),
    number: orderNumber(now),
    createdAt: now.toISOString(),
    address,
    shipping,
    lines: cart.lines.map((line) => ({
      title: line.variant.product.title,
      variantTitle: line.variant.title,
      handle: line.variant.product.handle,
      imageUrl: line.variant.product.images[0].url,
      quantity: line.quantity,
      unitPrice: line.variant.price,
      lineTotal: line.lineTotal,
    })),
    subtotal: money(subtotal, currency),
    shippingFee: money(shipping.fee, currency),
    total: money(subtotal + shipping.fee, currency),
  };

  ORDERS.set(order.id, order);
  return order;
}

export function getOrder(id: string): Order | null {
  return ORDERS.get(id) ?? null;
}

/* ---------------- Form validation ---------------- */

export type CheckoutErrors = Partial<Record<keyof ShippingAddress | "shipping", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP = /^\d{5}(-\d{4})?$/;

/** Accepts the usual US formats — (415) 555-0142, 415-555-0142, +1 415 555 0142. */
function isValidUsPhone(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  // Allow a leading country code of 1
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  // Neither the area code nor the exchange code may start with 0 or 1
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(local);
}

export function validateCheckout(form: FormData): {
  errors: CheckoutErrors;
  address: ShippingAddress;
  shipping: ShippingMethod;
} {
  const get = (key: string) => String(form.get(key) ?? "").trim();

  const address: ShippingAddress = {
    name: get("name"),
    phone: get("phone"),
    email: get("email"),
    state: get("state"),
    city: get("city"),
    address: get("address"),
    zip: get("zip"),
    note: get("note"),
  };

  const errors: CheckoutErrors = {};

  if (address.name.length < 2) errors.name = "Enter the recipient's name (at least 2 characters)";
  if (!isValidUsPhone(address.phone)) errors.phone = "Enter a valid 10-digit US phone number";
  if (!EMAIL.test(address.email)) errors.email = "Enter a valid email so we can send your order confirmation";
  if (!isValidStateCode(address.state)) errors.state = "Select a state";
  if (address.city.length < 2) errors.city = "Enter a city";
  if (address.address.length < 5) errors.address = "Enter a street address (number, street, unit)";
  if (!ZIP.test(address.zip)) errors.zip = "Enter a valid ZIP code (12345 or 12345-6789)";

  const shippingId = get("shipping");
  const shipping = getShippingMethod(shippingId);
  if (shippingId && shipping.id !== shippingId) errors.shipping = "Select a valid shipping method";

  return { errors, address, shipping };
}

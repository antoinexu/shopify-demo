import type { Cart } from "./cart.server";
import type { ShippingMethod } from "./shipping";

/**
 * Describes the quote actually shown by the form. It is compared with a fresh
 * server quote, never used as the source of an order's prices.
 */
export function checkoutQuote(cart: Cart, shipping: ShippingMethod): string {
  return JSON.stringify({
    lines: cart.lines.map((line) => [
      line.variantId, line.quantity, line.variant.price.amount, line.variant.price.currencyCode,
    ]),
    shipping: [shipping.id, shipping.fee],
  });
}

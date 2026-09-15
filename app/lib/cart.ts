/**
 * Cart rules that both sides of the wire need.
 *
 * The quantity ceiling is enforced on the server (cart.server.ts) and reflected
 * in the UI (routes/cart.tsx disables the plus button at the limit). It lives
 * here rather than in cart.server.ts because a component cannot import a
 * `.server` module — see the note at the top of shipping.ts.
 */

/** Per-line ceiling. High enough never to annoy a real customer, low enough to bound the cookie. */
export const MAX_QUANTITY = 99;

/** Coerces anything a form can submit into a storable quantity: an integer in [0, MAX_QUANTITY]. */
export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(Math.max(Math.trunc(quantity), 0), MAX_QUANTITY);
}

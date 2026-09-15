/**
 * Money: the value type, its formatting, and the arithmetic.
 *
 * Kept out of catalog/types.ts because money is not a catalog concept. The
 * catalog happens to carry prices, and so do shipping methods, carts and orders —
 * none of which should have to import from the product adapter contract to add
 * two amounts together.
 *
 * This module is **client-safe**: no `.server` suffix, nothing that reads
 * `process.env` or touches the network. Components format money directly.
 */

/** Shopify sends money as a decimal *string* plus a currency code, never a number. */
export type Money = {
  amount: string;
  currencyCode: string;
};

export function formatMoney({ amount, currencyCode }: Money): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(Number(amount));
}

/**
 * Arithmetic happens in integer minor units.
 *
 * To be precise about why: the two operations this app performs today — a price
 * times an integer quantity, and a sum of two-decimal amounts — survive float
 * arithmetic, because `toFixed(2)` rounds the error away. That is luck, and it
 * runs out the moment a percentage is involved: 8.25% tax on $6.00 is "0.49" in
 * floats and "0.50" in cents, and tax, discounts and partial refunds are exactly
 * what a storefront grows next.
 *
 * Doing it in integers means the correctness argument is "cents cannot lose a
 * fraction" rather than "the rounding happens to absorb it".
 *
 * The scale is fixed at 100 because that is what the rest of the app already
 * assumes (every amount is rendered with `toFixed(2)`). Zero-decimal currencies
 * like JPY still round-trip correctly — Intl drops the decimals at display time —
 * but a store dealing in them should scale per currency rather than globally.
 */
const MINOR_UNIT_SCALE = 100;

/** "89.00" → 8900. Takes a number too, since shipping fees are configured as plain numbers. */
export function toMinorUnits(amount: string | number): number {
  return Math.round(Number(amount) * MINOR_UNIT_SCALE);
}

/** 8900 → { amount: "89.00" }. */
export function fromMinorUnits(minor: number, currencyCode: string): Money {
  return { amount: (minor / MINOR_UNIT_SCALE).toFixed(2), currencyCode };
}

/**
 * Shipping methods and the shape of a delivery address.
 *
 * Both the server-side checkout action and the client-side checkout form need
 * these constants, which is why this file does **not** carry a `.server` suffix —
 * it has to be safe to import from the client.
 *
 * Do not move these back into orders.server.ts. That module holds the in-process
 * order store, and once a component references it React Router cannot strip it
 * (it only rewrites `loader` / `action` / `middleware` / `headers`), so the client
 * build fails with "Server-only module referenced by client".
 */

export type ShippingMethodId = "standard" | "express";

export type ShippingMethod = {
  id: ShippingMethodId;
  title: string;
  description: string;
  fee: number;
};

export const SHIPPING_METHODS: ShippingMethod[] = [
  { id: "standard", title: "Standard", description: "Arrives in 3–5 business days", fee: 0 },
  { id: "express", title: "Express", description: "Order by 5 PM ET, arrives next business day", fee: 15 },
];

/** Falls back to standard for anything unrecognized; callers decide whether that's an error. */
export function getShippingMethod(id: string): ShippingMethod {
  return SHIPPING_METHODS.find((method) => method.id === id) ?? SHIPPING_METHODS[0];
}

export type ShippingAddress = {
  name: string;
  phone: string;
  email: string;
  state: string;
  city: string;
  address: string;
  zip: string;
  note: string;
};

export type UsState = { code: string; name: string };

export const US_STATES: UsState[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

const STATE_CODES = new Set(US_STATES.map((state) => state.code));

export function isValidStateCode(code: string): boolean {
  return STATE_CODES.has(code);
}

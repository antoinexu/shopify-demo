import { useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/checkout";
import { clearCart, getCart, getCheckoutId } from "~/lib/cart.server";
// Used only inside loader / action, so React Router strips these from the client bundle
import { createOrder, getOrderForCheckout, validateCheckout } from "~/lib/orders.server";
import { checkoutQuote } from "~/lib/checkout";
// Used inside the component, so these must come from a module without the .server suffix
import {
  SHIPPING_METHODS,
  US_STATES,
  type ShippingAddress,
  type ShippingMethodId,
} from "~/lib/shipping";
import { formatMoney, fromMinorUnits, toMinorUnits } from "~/lib/money";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Checkout · MERIDIAN" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const cart = await getCart(request);
  // An empty cart has no business on the checkout page
  if (cart.lines.length === 0 && cart.missingItems.length === 0) {
    throw redirect("/cart");
  }
  return { cart };
}

export async function action({ request }: Route.ActionArgs) {
  const checkoutId = await getCheckoutId(request);
  if (checkoutId) {
    const existing = getOrderForCheckout(checkoutId);
    if (existing) {
      return redirect(`/orders/${existing.id}`, { headers: { "Set-Cookie": await clearCart(request) } });
    }
  }
  const form = await request.formData();
  const { errors, address, shipping } = validateCheckout(form);

  // Guard against the cart being emptied while the customer sat on this page
  const cart = await getCart(request);
  if (cart.lines.length === 0 && cart.missingItems.length === 0) {
    throw redirect("/cart");
  }

  // Availability is rechecked here, against the catalog as it is now. The cart
  // page and this form both render from a load that may be minutes old, and a
  // line can sell out while it sits in the cart; this is the last point before
  // an order exists.
  // Both problems can occur together; report both rather than letting one hide the other
  const cartProblems: string[] = [];
  const soldOut = cart.lines.filter((line) => !line.variant.availableForSale);
  if (soldOut.length > 0) {
    const names = soldOut.map((line) => `${line.variant.product.title} (${line.variant.title})`);
    cartProblems.push(`Sold out since you added it: ${names.join(", ")}. Remove it from your cart to continue.`);
  }
  if (cart.missingItems.length > 0) {
    cartProblems.push("Some items are no longer available. Review your cart before placing an order.");
  }
  if (cartProblems.length > 0) errors.cart = cartProblems.join(" ");

  if (Object.keys(errors).length > 0) {
    // shippingId rides along with the address values: without JavaScript the page
    // is re-rendered from scratch, and a customer who picked Express should not
    // find themselves back on Standard just because a ZIP code was malformed.
    return data(
      { errors, values: address, shippingId: shipping.id, reviewRequired: false },
      { status: errors.cart ? 409 : 400 },
    );
  }

  if (form.get("quote") !== checkoutQuote(cart, shipping)) {
    // 409 like the other refusals: no order was created, the customer must resubmit
    return data({ errors, values: address, shippingId: shipping.id, reviewRequired: true }, { status: 409 });
  }

  // Every cart write sets a checkout id, so a cart always has one. The fallback
  // only covers a cookie written by hand: it still gets an order, just without
  // duplicate-submit protection.
  const order = createOrder(cart, address, shipping, checkoutId ?? crypto.randomUUID());
  const cookie = await clearCart(request);

  return redirect(`/orders/${order.id}`, { headers: { "Set-Cookie": cookie } });
}

const EMPTY_VALUES: ShippingAddress = {
  name: "",
  phone: "",
  email: "",
  state: "",
  city: "",
  address: "",
  zip: "",
  note: "",
};

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
  const { cart } = loaderData;
  const errors = actionData?.errors ?? {};
  const values = actionData?.values ?? EMPTY_VALUES;

  const navigation = useNavigation();
  const submitting = navigation.formAction === "/checkout";

  // Shipping cost is reflected in the summary immediately, without a round trip.
  // The initial value only matters on a fresh document — with JavaScript the
  // component stays mounted across a failed submit and keeps its own state.
  const [shippingId, setShippingId] = useState<ShippingMethodId>(
    actionData?.shippingId ?? SHIPPING_METHODS[0].id,
  );
  const shipping = SHIPPING_METHODS.find((method) => method.id === shippingId) ?? SHIPPING_METHODS[0];

  const currency = cart.subtotal.currencyCode;
  // Same integer-cent arithmetic the server uses, so the figure on the button is
  // the figure createOrder records — not one that rounds differently
  const total = fromMinorUnits(toMinorUnits(cart.subtotal.amount) + toMinorUnits(shipping.fee), currency);

  // Known sold out at load time: say so up front and block the submit, rather
  // than letting the customer fill in the whole form only for the action to refuse it.
  const blocked = cart.missingItems.length > 0 || cart.lines.some((line) => !line.variant.availableForSale);

  return (
    <section className="checkout">
      <div className="checkout-form">
        <Link to="/cart" className="back-link">
          &larr; Back to cart
        </Link>
        <h1>Checkout</h1>

        {blocked || errors.cart ? (
          <p className="field-error" role="alert">
            {errors.cart ?? "Something in your cart is no longer available."}{" "}
            <Link to="/cart">Review your cart</Link>
          </p>
        ) : null}

        <Form method="post" noValidate>
          <input type="hidden" name="quote" value={checkoutQuote(cart, shipping)} />
          {actionData?.reviewRequired ? (
            <p role="status">Your order total has been updated. Review the summary and place your order to confirm.</p>
          ) : null}
          <fieldset className="field-group" disabled={submitting}>
            <legend>Shipping details</legend>

            <div className="field-row">
              <Field
                name="name"
                label="Full name"
                defaultValue={values.name}
                error={errors.name}
                autoComplete="name"
              />
              <Field
                name="phone"
                label="Phone"
                type="tel"
                defaultValue={values.phone}
                error={errors.phone}
                autoComplete="tel"
                placeholder="(415) 555-0142"
              />
            </div>

            <Field
              name="email"
              label="Email"
              type="email"
              defaultValue={values.email}
              error={errors.email}
              autoComplete="email"
              hint="Your order confirmation will be sent here"
            />

            <Field
              name="address"
              label="Street address"
              defaultValue={values.address}
              error={errors.address}
              autoComplete="street-address"
              placeholder="Number, street, apartment"
            />

            <div className="field-row">
              <Field
                name="city"
                label="City"
                defaultValue={values.city}
                error={errors.city}
                autoComplete="address-level2"
              />

              <div className="field">
                <label htmlFor="state">State</label>
                <select
                  id="state"
                  name="state"
                  defaultValue={values.state}
                  autoComplete="address-level1"
                  aria-invalid={errors.state ? true : undefined}
                  aria-describedby={errors.state ? "state-error" : undefined}
                >
                  <option value="">Select a state</option>
                  {US_STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </select>
                {errors.state ? (
                  <p className="field-error" id="state-error">
                    {errors.state}
                  </p>
                ) : null}
              </div>

              <Field
                name="zip"
                label="ZIP code"
                defaultValue={values.zip}
                error={errors.zip}
                autoComplete="postal-code"
                placeholder="94103"
              />
            </div>

            <div className="field">
              <label htmlFor="note">Order notes (optional)</label>
              <textarea id="note" name="note" rows={3} defaultValue={values.note} />
            </div>
          </fieldset>

          <fieldset className="field-group" disabled={submitting}>
            <legend>Shipping method</legend>
            {SHIPPING_METHODS.map((method) => (
              <label
                key={method.id}
                className="ship-option"
              >
                <input
                  type="radio"
                  name="shipping"
                  value={method.id}
                  checked={method.id === shippingId}
                  onChange={() => setShippingId(method.id)}
                />
                <span className="ship-main">
                  <strong>{method.title}</strong>
                  <small>{method.description}</small>
                </span>
                <span className="ship-fee">
                  {method.fee === 0
                    ? "Free"
                    : formatMoney({ amount: method.fee.toFixed(2), currencyCode: currency })}
                </span>
              </label>
            ))}
            {errors.shipping ? <p className="field-error">{errors.shipping}</p> : null}
          </fieldset>

          <button type="submit" className="button button-block" disabled={submitting || blocked}>
            {submitting
              ? "Placing order…"
              : `Place order · ${formatMoney(total)}`}
          </button>
          <p className="summary-note">
            This demo takes no real payment; submitting creates the order directly.
          </p>
        </Form>
      </div>

      <aside className="checkout-summary">
        <h2>Order summary</h2>
        <ul className="summary-lines">
          {cart.lines.map((line) => (
            <li key={line.variantId}>
              <span className="summary-thumb">
                <img src={line.variant.product.images[0].url} alt="" width={56} height={56} />
                <span className="summary-qty">{line.quantity}</span>
              </span>
              <span className="summary-text">
                <strong>{line.variant.product.title}</strong>
                <small>{line.variant.title}</small>
              </span>
              <span className="summary-amount">{formatMoney(line.lineTotal)}</span>
            </li>
          ))}
        </ul>

        <div className="summary-row">
          <span>Subtotal</span>
          <span>{formatMoney(cart.subtotal)}</span>
        </div>
        <div className="summary-row">
          <span>Shipping</span>
          <span>
            {shipping.fee === 0
              ? "Free"
              : formatMoney({ amount: shipping.fee.toFixed(2), currencyCode: currency })}
          </span>
        </div>
        <div className="summary-row summary-total">
          <span>Total</span>
          <strong>{formatMoney(total)}</strong>
        </div>
      </aside>
    </section>
  );
}

type FieldProps = {
  name: string;
  label: string;
  error?: string;
  defaultValue?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
};

function Field({
  name,
  label,
  error,
  defaultValue,
  type = "text",
  autoComplete,
  placeholder,
  hint,
}: FieldProps) {
  const errorId = `${name}-error`;
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
      {!error && hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

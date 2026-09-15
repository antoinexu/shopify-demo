import { useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/checkout";
import { clearCart, getCart } from "~/lib/cart.server";
// Used only inside loader / action, so React Router strips these from the client bundle
import { createOrder, validateCheckout } from "~/lib/orders.server";
// Used inside the component, so these must come from a module without the .server suffix
import { SHIPPING_METHODS, US_STATES, type ShippingAddress } from "~/lib/shipping";
import { formatMoney } from "~/lib/catalog/types";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Checkout · MERIDIAN" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const cart = await getCart(request);
  // An empty cart has no business on the checkout page
  if (cart.lines.length === 0) {
    throw redirect("/cart");
  }
  return { cart };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const { errors, address, shipping } = validateCheckout(form);

  // Guard against the cart being emptied while the customer sat on this page
  const cart = await getCart(request);
  if (cart.lines.length === 0) {
    throw redirect("/cart");
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors, values: address }, { status: 400 });
  }

  const order = createOrder(cart, address, shipping);
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

  // Shipping cost is reflected in the summary immediately, without a round trip
  const [shippingId, setShippingId] = useState(SHIPPING_METHODS[0].id);
  const shipping = SHIPPING_METHODS.find((method) => method.id === shippingId) ?? SHIPPING_METHODS[0];

  const currency = cart.subtotal.currencyCode;
  const total = Number(cart.subtotal.amount) + shipping.fee;

  return (
    <section className="checkout">
      <div className="checkout-form">
        <Link to="/cart" className="back-link">
          &larr; Back to cart
        </Link>
        <h1>Checkout</h1>

        <Form method="post" noValidate>
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
                className={method.id === shippingId ? "ship-option is-selected" : "ship-option"}
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

          <button type="submit" className="button button-block" disabled={submitting}>
            {submitting
              ? "Placing order…"
              : `Place order · ${formatMoney({ amount: total.toFixed(2), currencyCode: currency })}`}
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
          <strong>{formatMoney({ amount: total.toFixed(2), currencyCode: currency })}</strong>
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

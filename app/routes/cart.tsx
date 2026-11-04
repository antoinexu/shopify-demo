import { data, Link, useFetcher } from "react-router";
import type { Route } from "./+types/cart";
import {
  addToCart,
  CartCapacityError,
  clearCart,
  getCart,
  removeCartLine,
  removeMissingItems,
  updateCartLine,
  type CartLine,
} from "~/lib/cart.server";
import { getVariantById } from "~/lib/catalog.server";
// The ceiling the server enforces, imported rather than repeated
import { MAX_QUANTITY } from "~/lib/cart";
import { formatMoney } from "~/lib/money";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Cart · MERIDIAN" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const cart = await getCart(request);
  return data({ cart }, cart.missingItems.length > 0
    ? { headers: { "Set-Cookie": await removeMissingItems(request, cart) } }
    : undefined);
}

/** Every cart write in the app posts here; `intent` selects the operation. */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const variantId = String(form.get("variantId") ?? "");
  const quantity = Number(form.get("quantity") ?? 1);

  let cookie: string;

  switch (intent) {
    case "add": {
      // Validate before writing. getCart skips unresolvable ids so the page never
      // breaks, but without this check any string lands in the cookie and then
      // costs a slot in every batched catalog lookup from here on.
      const variant = await getVariantById(variantId);
      if (!variant) {
        throw data({ message: `Unknown variant: ${variantId}` }, { status: 400 });
      }
      // The product page disables sold-out options, but that is only the UI. A
      // variant can also sell out while the page sits open, which is an ordinary
      // outcome rather than an error, so it is returned for the form to show
      // instead of thrown, which would replace the whole page with the error boundary.
      if (!variant.availableForSale) {
        return data(
          { ok: false as const, intent, variantId, code: "SOLD_OUT", message: "This option just sold out." },
          { status: 409 },
        );
      }
      try {
        cookie = await addToCart(request, variantId, quantity);
      } catch (error) {
        if (!(error instanceof CartCapacityError)) throw error;
        return data(
          { ok: false as const, intent, variantId, code: "CART_FULL", message: error.message },
          { status: 400 },
        );
      }
      break;
    }
    case "update":
      cookie = await updateCartLine(request, variantId, quantity);
      break;
    case "remove":
      cookie = await removeCartLine(request, variantId);
      break;
    case "clear":
      cookie = await clearCart(request);
      break;
    default:
      throw data({ message: `Unknown intent: ${intent}` }, { status: 400 });
  }

  // Returning Set-Cookie makes React Router revalidate every loader, which is
  // how the header badge picks up the new quantity.
  return data({ ok: true as const, intent }, { headers: { "Set-Cookie": cookie } });
}

export default function CartPage({ loaderData, actionData }: Route.ComponentProps) {
  const { cart } = loaderData;
  const fetcher = useFetcher();

  // Only reached without JavaScript: a plain form POST to /cart renders this
  // page, while the fetcher path shows the message on the product page instead.
  const notice = (
    <>
      {cart.missingItems.length > 0 ? (
        <p role="status">Some items are no longer available and were removed. Please review your cart.</p>
      ) : null}
      {actionData && !actionData.ok ? (
        <p className="field-error" role="alert">
          {actionData.message}
        </p>
      ) : null}
    </>
  );

  if (cart.lines.length === 0) {
    return (
      <section className="empty">
        {notice}
        <h1>Your cart is empty</h1>
        <p>Nothing caught your eye yet?</p>
        <Link to="/" className="button">
          Start shopping
        </Link>
      </section>
    );
  }

  return (
    <section className="cart">
      {notice}
      <div className="cart-head">
        <h1>Cart</h1>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="clear" />
          <button type="submit" className="link-button">
            Clear cart
          </button>
        </fetcher.Form>
      </div>

      <ul className="cart-lines">
        {cart.lines.map((line) => (
          <CartLineRow key={line.variantId} line={line} />
        ))}
      </ul>

      <div className="cart-summary">
        <div className="summary-row">
          <span>Subtotal ({cart.totalQuantity} items)</span>
          <strong>{formatMoney(cart.subtotal)}</strong>
        </div>
        <p className="summary-note">Shipping is calculated at checkout.</p>
        <Link to="/checkout" className="button button-block" prefetch="intent">
          Checkout
        </Link>
      </div>
    </section>
  );
}

function CartLineRow({ line }: { line: CartLine }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  // Optimistic update: render the new quantity while the request is still in
  // flight rather than waiting for the server to answer.
  const pending = fetcher.formData;
  const quantity =
    pending?.get("intent") === "update" ? Number(pending.get("quantity")) : line.quantity;

  const { variant } = line;
  const image = variant.product.images[0];

  return (
    <li className={busy ? "cart-line is-busy" : "cart-line"}>
      <img src={image.url} alt={image.altText} width={96} height={96} />

      <div className="cart-line-info">
        <Link to={`/products/${variant.product.handle}`} className="cart-line-title">
          {variant.product.title}
        </Link>
        <p className="cart-line-variant">{variant.title}</p>
        <p className="cart-line-unit">{formatMoney(variant.price)}</p>
        {variant.availableForSale ? null : (
          <p className="field-error">Sold out. Remove it to check out.</p>
        )}
      </div>

      <fetcher.Form method="post" className="stepper">
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="variantId" value={line.variantId} />
        <button
          type="submit"
          name="quantity"
          value={quantity - 1}
          aria-label="Decrease quantity"
          disabled={busy}
        >
          &minus;
        </button>
        <span aria-live="polite">{quantity}</span>
        <button
          type="submit"
          name="quantity"
          value={quantity + 1}
          aria-label="Increase quantity"
          disabled={busy || quantity >= MAX_QUANTITY}
        >
          +
        </button>
      </fetcher.Form>

      <div className="cart-line-total">{formatMoney(line.lineTotal)}</div>

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="remove" />
        <input type="hidden" name="variantId" value={line.variantId} />
        <button type="submit" className="link-button" disabled={busy}>
          Remove
        </button>
      </fetcher.Form>
    </li>
  );
}

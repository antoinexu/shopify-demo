import { data, Link, useFetcher } from "react-router";
import type { Route } from "./+types/cart";
import {
  addToCart,
  clearCart,
  getCart,
  removeCartLine,
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
  return { cart: await getCart(request) };
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
      cookie = await addToCart(request, variantId, quantity);
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
  return data({ ok: true, intent }, { headers: { "Set-Cookie": cookie } });
}

export default function CartPage({ loaderData }: Route.ComponentProps) {
  const { cart } = loaderData;
  const fetcher = useFetcher();

  if (cart.lines.length === 0) {
    return (
      <section className="empty">
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

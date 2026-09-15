import { Link } from "react-router";
import type { Route } from "./+types/order";
import { getOrder } from "~/lib/orders.server";
import { US_STATES } from "~/lib/shipping";
import { formatMoney } from "~/lib/catalog/types";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `Order ${data.order.number} · MERIDIAN` : "Order not found" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const order = getOrder(params.id);
  if (!order) {
    throw new Response("Not Found", { status: 404 });
  }
  return { order };
}

export default function OrderConfirmation({ loaderData }: Route.ComponentProps) {
  const { order } = loaderData;
  const { address } = order;

  // The time zone has to be pinned: without it SSR renders in the Node process
  // time zone and hydration renders in the browser's, producing different
  // strings, a hydration mismatch, and a visible flash.
  const placedAt = new Date(order.createdAt).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/New_York",
  });

  const stateName = US_STATES.find((state) => state.code === address.state)?.name ?? address.state;

  return (
    <section className="order">
      <div className="order-hero">
        <span className="order-check" aria-hidden="true">
          ✓
        </span>
        <h1>Order confirmed</h1>
        <p>
          Order <strong>{order.number}</strong> &middot; {placedAt} ET
        </p>
        <p className="summary-note">
          A confirmation email went to {address.email} (this demo sends nothing for real). Bookmark
          this page to check on your order any time.
        </p>
      </div>

      <div className="order-body">
        <div className="order-panel">
          <h2>Items</h2>
          <ul className="summary-lines">
            {order.lines.map((line, index) => (
              <li key={`${line.handle}-${index}`}>
                <span className="summary-thumb">
                  <img src={line.imageUrl} alt="" width={56} height={56} />
                  <span className="summary-qty">{line.quantity}</span>
                </span>
                <span className="summary-text">
                  <Link to={`/products/${line.handle}`}>
                    <strong>{line.title}</strong>
                  </Link>
                  <small>{line.variantTitle}</small>
                </span>
                <span className="summary-amount">{formatMoney(line.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <div className="summary-row">
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotal)}</span>
          </div>
          <div className="summary-row">
            <span>Shipping ({order.shipping.title})</span>
            <span>
              {Number(order.shippingFee.amount) === 0 ? "Free" : formatMoney(order.shippingFee)}
            </span>
          </div>
          <div className="summary-row summary-total">
            <span>Total paid</span>
            <strong>{formatMoney(order.total)}</strong>
          </div>
        </div>

        <div className="order-panel">
          <h2>Shipping</h2>
          <dl className="order-facts">
            <dt>Recipient</dt>
            <dd>
              {address.name} &middot; {address.phone}
            </dd>
            <dt>Address</dt>
            <dd>
              {address.address}
              <br />
              {address.city}, {stateName} {address.zip}
            </dd>
            <dt>Method</dt>
            <dd>
              {order.shipping.title} &middot; {order.shipping.description}
            </dd>
            {address.note ? (
              <>
                <dt>Notes</dt>
                <dd>{address.note}</dd>
              </>
            ) : null}
          </dl>

          <Link to="/" className="button">
            Continue shopping
          </Link>
        </div>
      </div>
    </section>
  );
}

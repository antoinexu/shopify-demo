import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/product";
import { AddToCartForm } from "~/components/AddToCartForm";
import { getProductByHandle } from "~/lib/catalog.server";
import type { Product } from "~/lib/catalog/types";
import { formatMoney } from "~/lib/money";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.product.title} · MERIDIAN` : "Product not found" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const product = await getProductByHandle(params.handle);
  // A published Shopify product always has at least one variant, but an import
  // can leave one with none — and the page indexes variants[0] for its price and
  // its Add to cart button. Nothing to sell here, so treat it as not found
  // rather than crashing the route.
  if (!product || product.variants.length === 0) {
    throw new Response("Not Found", { status: 404 });
  }
  return { product };
}

export default function ProductRoute({ loaderData }: Route.ComponentProps) {
  // React Router keeps this component mounted when navigating from one product
  // to another, and with it the selected-option state, which would then name a
  // variant the new product does not have: no radio would be checked, and the
  // form would submit without a variantId. Keying on the product remounts it.
  return <ProductDetail key={loaderData.product.id} product={loaderData.product} />;
}

function ProductDetail({ product }: { product: Product }) {
  const firstAvailable = product.variants.find((variant) => variant.availableForSale);
  const [selectedId, setSelectedId] = useState(firstAvailable?.id ?? product.variants[0].id);

  const selected = product.variants.find((variant) => variant.id === selectedId) ?? product.variants[0];
  const image = product.images[0];

  return (
    <article className="product">
      <div className="product-media">
        <img src={image.url} alt={image.altText} width={720} height={720} />
      </div>

      <div className="product-info">
        <Link to="/" className="back-link">
          &larr; Back to all products
        </Link>

        <h1>{product.title}</h1>
        <p className="product-price">{formatMoney(selected.price)}</p>
        <p className="product-desc">{product.description}</p>

        <AddToCartForm variantId={selected.id} disabled={!selected.availableForSale}>
          <fieldset className="variants">
            <legend>Options</legend>
            {product.variants.map((variant) => (
              <label
                key={variant.id}
                className={variant.availableForSale ? "variant" : "variant is-disabled"}
              >
                <input
                  type="radio"
                  name="variantId"
                  value={variant.id}
                  checked={variant.id === selectedId}
                  disabled={!variant.availableForSale}
                  onChange={() => setSelectedId(variant.id)}
                />
                <span>{variant.title} · {formatMoney(variant.price)}</span>
              </label>
            ))}
          </fieldset>
        </AddToCartForm>
      </div>
    </article>
  );
}

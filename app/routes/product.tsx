import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/product";
import { AddToCartForm } from "~/components/AddToCartForm";
import { getProductByHandle } from "~/lib/catalog.server";
import { formatMoney } from "~/lib/catalog/types";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.product.title} · MERIDIAN` : "Product not found" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const product = await getProductByHandle(params.handle);
  if (!product) {
    throw new Response("Not Found", { status: 404 });
  }
  return { product };
}

export default function ProductDetail({ loaderData }: Route.ComponentProps) {
  const { product } = loaderData;
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

        <fieldset className="variants">
          <legend>Options</legend>
          {product.variants.map((variant) => (
            <label
              key={variant.id}
              className={[
                "variant",
                variant.id === selectedId ? "is-selected" : "",
                variant.availableForSale ? "" : "is-disabled",
              ]
                .join(" ")
                .trim()}
            >
              <input
                type="radio"
                name="variant"
                value={variant.id}
                checked={variant.id === selectedId}
                disabled={!variant.availableForSale}
                onChange={() => setSelectedId(variant.id)}
              />
              <span>{variant.title}</span>
            </label>
          ))}
        </fieldset>

        <AddToCartForm variantId={selected.id} disabled={!selected.availableForSale} />
      </div>
    </article>
  );
}

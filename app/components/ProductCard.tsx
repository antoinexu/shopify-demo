import { Link } from "react-router";
import { formatMoney, type Product } from "~/lib/catalog/types";

export function ProductCard({ product }: { product: Product }) {
  const image = product.images[0];
  const soldOut = product.variants.every((variant) => !variant.availableForSale);

  return (
    <Link to={`/products/${product.handle}`} className="card" prefetch="intent">
      <div className="card-media">
        <img src={image.url} alt={image.altText} loading="lazy" width={480} height={480} />
        {soldOut ? <span className="tag">Sold out</span> : null}
      </div>
      <div className="card-body">
        <h2 className="card-title">{product.title}</h2>
        <p className="card-price">From {formatMoney(product.priceRange.minVariantPrice)}</p>
      </div>
    </Link>
  );
}

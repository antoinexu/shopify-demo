import { Link } from "react-router";
import { formatMoney, type ProductSummary } from "~/lib/catalog/types";

/**
 * Takes a ProductSummary rather than a Product: the card renders six fields, so
 * those six are all the home loader has to serialize. See toProductSummary.
 */
export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link to={`/products/${product.handle}`} className="card" prefetch="intent">
      <div className="card-media">
        <img src={product.image.url} alt={product.image.altText} loading="lazy" width={480} height={480} />
        {product.availableForSale ? null : <span className="tag">Sold out</span>}
      </div>
      <div className="card-body">
        <h2 className="card-title">{product.title}</h2>
        <p className="card-price">From {formatMoney(product.minPrice)}</p>
      </div>
    </Link>
  );
}

import type { Route } from "./+types/home";
import { ProductCard } from "~/components/ProductCard";
import { getProducts } from "~/lib/catalog.server";
import { toProductSummary } from "~/lib/catalog/types";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "All products · MERIDIAN" },
    { name: "description", content: "A Shopify-style storefront demo built with React Router v7." },
  ];
}

export async function loader() {
  const products = await getProducts();
  // Ship only what the grid renders. Returning the full products here would
  // serialize every description and every variant into the HTML document.
  return { products: products.map(toProductSummary) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { products } = loaderData;

  return (
    <>
      <section className="hero">
        <h1>Good things for everyday use</h1>
        <p>
          {products.length} products · Free shipping · 30-day returns
        </p>
      </section>

      <section className="grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </section>
    </>
  );
}

import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
  type ShouldRevalidateFunction,
} from "react-router";
import type { Route } from "./+types/root";
import { Header } from "~/components/Header";
import { catalogSource } from "~/lib/catalog.server";
import { getCartQuantity } from "~/lib/cart.server";
import type { loader as cartLoader } from "./routes/cart";
import type { loader as checkoutLoader } from "./routes/checkout";
import "./styles/app.css";

// The cart loader removes delisted lines from the cookie. The root loader only
// reruns after actions by default, so without this the badge would keep the
// old count after leaving the cart. Rerunning is cheap: it only reads the cookie.
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
  currentUrl.pathname !== nextUrl.pathname || defaultShouldRevalidate;

export async function loader({ request }: Route.LoaderArgs) {
  // Deliberately the cheap count: this loader runs on every page, so it must not
  // reach the catalog. See getCartQuantity.
  return { cartQuantity: await getCartQuantity(request), catalogSource };
}

export function Layout({ children }: { children: ReactNode }) {
  // The ErrorBoundary renders through Layout too, and at that point the root
  // loader may never have run -- hence the fallback.
  const data = useRouteLoaderData<typeof loader>("root");
  // Cart and checkout already resolve the cart against the catalog, so their
  // count is exact. Reusing it avoids a second catalog lookup in the root loader.
  // Both hooks are called unconditionally: `??` would skip the second one on
  // some renders and break the rules of hooks.
  const cartPage = useRouteLoaderData<typeof cartLoader>("routes/cart");
  const checkoutPage = useRouteLoaderData<typeof checkoutLoader>("routes/checkout");
  const pageCart = cartPage?.cart ?? checkoutPage?.cart;
  const cartQuantity = pageCart?.totalQuantity ?? data?.cartQuantity ?? 0;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Header cartQuantity={cartQuantity} />
        <main className="main">{children}</main>
        <footer className="footer">
          <p>
            Shopify Demo &middot; React Router v7 &middot; catalog:{" "}
            {/* Which backend served this page, so you never have to guess whether
                you are looking at fixtures or a real store. */}
            <span className={data?.catalogSource === "shopify" ? "source-live" : "source-mock"}>
              {data?.catalogSource ?? "unknown"}
            </span>
          </p>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "This page failed to load. Please try again.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status}`;
    message = error.status === 404 ? "We could not find that page." : error.statusText || message;
  } else if (import.meta.env.DEV && error instanceof Error) {
    message = error.message;
  }

  return (
    <section className="error-page">
      <h1>{title}</h1>
      <p>{message}</p>
      <a className="button" href="/">
        Back to home
      </a>
    </section>
  );
}

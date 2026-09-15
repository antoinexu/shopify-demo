import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import { Header } from "~/components/Header";
import { catalogSource } from "~/lib/catalog.server";
import { getCartQuantity } from "~/lib/cart.server";
import "./styles/app.css";

export async function loader({ request }: Route.LoaderArgs) {
  // Deliberately the cheap count: this loader runs on every page, so it must not
  // reach the catalog. See getCartQuantity.
  return { cartQuantity: await getCartQuantity(request), catalogSource };
}

export function Layout({ children }: { children: ReactNode }) {
  // The ErrorBoundary renders through Layout too, and at that point the root
  // loader may never have run -- hence the fallback.
  const data = useRouteLoaderData<typeof loader>("root");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Header cartQuantity={data?.cartQuantity ?? 0} />
        <main className="main">{children}</main>
        <footer className="footer">
          <p>
            Shopify Demo &middot; React Router v7 &middot; catalog:{" "}
            {/* Which backend served this page. Essential when the app is pointed at a
                migrated store: you should never have to guess whether you are looking
                at fixtures or the real thing. */}
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

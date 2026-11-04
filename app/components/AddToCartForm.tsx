import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";

type Props = {
  variantId: string;
  disabled?: boolean;
  quantity?: number;
  label?: string;
  children?: ReactNode;
};

/**
 * Submits through a fetcher so the page never navigates. Without JavaScript it
 * degrades to a plain form POST to /cart and still adds the item -- that is
 * React Router progressive enhancement.
 */
export function AddToCartForm({ variantId, disabled = false, quantity = 1, label = "Add to cart", children }: Props) {
  const fetcher = useFetcher();
  const [justAdded, setJustAdded] = useState(false);
  // fetcher.state runs idle -> submitting -> loading -> idle. Comparing only the
  // previous frame against the current one is what keeps the middle `loading`
  // frame from wiping the flag.
  const prevState = useRef(fetcher.state);

  const busy = fetcher.state !== "idle";

  // A rejected add (the variant sold out after the page loaded) comes back as
  // data rather than a thrown error. Scoped to the variant it was about, so
  // picking another option clears it.
  const result = fetcher.data as { ok: boolean; variantId?: string; code?: string; message?: string } | undefined;
  const rejected = result?.ok === false && result.variantId === variantId ? result.message : undefined;
  const soldOut = disabled || (rejected !== undefined && result?.code === "SOLD_OUT");

  useEffect(() => {
    if (prevState.current !== "idle" && fetcher.state === "idle") {
      // Idle means the request finished, not that it succeeded
      setJustAdded(fetcher.data?.ok === true);
    } else if (fetcher.state === "submitting") {
      // Clicked again: clear the previous confirmation so the timer below restarts
      setJustAdded(false);
    }
    prevState.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(false), 1800);
    return () => clearTimeout(timer);
  }, [justAdded]);

  return (
    <fetcher.Form method="post" action="/cart" className="add-form">
      <input type="hidden" name="intent" value="add" />
      {children ?? <input type="hidden" name="variantId" value={variantId} />}
      <input type="hidden" name="quantity" value={quantity} />
      <button type="submit" className="button" disabled={soldOut || busy}>
        {soldOut ? "Sold out" : busy ? "Adding…" : justAdded ? "Added ✓" : label}
      </button>
      {rejected ? (
        <p className="field-error" role="alert">
          {rejected}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

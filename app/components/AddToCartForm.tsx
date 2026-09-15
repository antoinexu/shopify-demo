import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

type Props = {
  variantId: string;
  disabled?: boolean;
  quantity?: number;
  label?: string;
};

/**
 * Submits through a fetcher so the page never navigates. Without JavaScript it
 * degrades to a plain form POST to /cart and still adds the item -- that is
 * React Router progressive enhancement.
 */
export function AddToCartForm({ variantId, disabled = false, quantity = 1, label = "Add to cart" }: Props) {
  const fetcher = useFetcher();
  const [justAdded, setJustAdded] = useState(false);
  // fetcher.state runs idle -> submitting -> loading -> idle. Comparing only the
  // previous frame against the current one is what keeps the middle `loading`
  // frame from wiping the flag.
  const prevState = useRef(fetcher.state);

  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (prevState.current !== "idle" && fetcher.state === "idle") {
      setJustAdded(true);
    } else if (fetcher.state === "submitting") {
      // Clicked again: clear the previous confirmation so the timer below restarts
      setJustAdded(false);
    }
    prevState.current = fetcher.state;
  }, [fetcher.state]);

  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(false), 1800);
    return () => clearTimeout(timer);
  }, [justAdded]);

  return (
    <fetcher.Form method="post" action="/cart" className="add-form">
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value={quantity} />
      <button type="submit" className="button" disabled={disabled || busy}>
        {disabled ? "Sold out" : busy ? "Adding…" : justAdded ? "Added ✓" : label}
      </button>
    </fetcher.Form>
  );
}

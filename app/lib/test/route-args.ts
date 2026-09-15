import { expect } from "vitest";

/**
 * Helpers for calling a route's loader or action directly.
 *
 * React Router ships no public constructor for loader arguments, so building
 * them means asserting the shape. The assertion is confined to this file rather
 * than repeated in every test: it silently bypasses type checking, and one
 * copy is one place to fix when the framework's signature changes.
 */

/** Builds loader/action args. Only `request` and `params` are ever read by this app's routes. */
export function loaderArgs<T>(params: Record<string, string>, url: string): T {
  return { request: new Request(url), params, context: {} } as unknown as T;
}

/** Asserts the loader rejected with a Response — not a TypeError — and returns its status. */
export async function statusOfThrown(promise: Promise<unknown>): Promise<number> {
  const thrown = await promise.catch((error) => error);
  expect(thrown, "the loader must throw a Response, not a plain Error").toBeInstanceOf(Response);
  return (thrown as Response).status;
}

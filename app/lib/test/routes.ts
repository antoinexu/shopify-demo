import { expect } from "vitest";

/**
 * Helpers for driving a route's loader or action directly.
 *
 * React Router ships no public constructor for loader arguments, and `data()`
 * returns a wrapper rather than a Response, so tests have to know both shapes.
 * Keeping that knowledge here means the type assertion below — which silently
 * bypasses type checking — exists in exactly one place to fix when the
 * framework's signature changes.
 */

/** Builds loader/action args. Only `request` and `params` are ever read by this app's routes. */
export function routeArgs<T>(request: Request, params: Record<string, string> = {}): T {
  return { request, params, context: {} } as unknown as T;
}

/** Asserts the loader rejected with a Response — not a TypeError — and returns its status. */
export async function statusOfThrown(promise: Promise<unknown>): Promise<number> {
  const thrown = await promise.catch((error) => error);
  expect(thrown, "the loader must throw a Response, not a plain Error").toBeInstanceOf(Response);
  return (thrown as Response).status;
}

/** Reads the status, payload and headers off whatever `data()` (or a thrown one) produced. */
export function unwrap(result: unknown): { data: unknown; status: number; headers: Headers } {
  const wrapper = result as { data: unknown; init?: ResponseInit | null };
  const init = wrapper.init ?? {};
  return {
    data: wrapper.data,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
  };
}

/** Turns a Set-Cookie response header back into a Cookie request header, as a browser would. */
export function asRequestCookie(setCookie: string): string {
  return setCookie.split(";")[0];
}

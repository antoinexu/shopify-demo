import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Separate from vite.config.ts on purpose: the React Router plugin builds a
 * route graph and injects its own entry points, none of which these tests want.
 * They exercise plain modules, so a bare Node environment is the right fit.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});

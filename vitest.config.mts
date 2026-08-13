import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Tests cover the pure backend logic — prompt composition, batch state
 * derivation, concurrency and validation. That is where the product's
 * correctness lives and it needs no browser, no network and no provider.
 *
 * The alias mirrors `tsconfig.json`, kept manual rather than pulling in
 * another dependency just to read it.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});

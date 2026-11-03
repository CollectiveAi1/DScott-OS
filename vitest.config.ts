import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // Node sees the client build of this marker package and throws. Server modules are exactly
      // what these tests exercise, so resolve it to the no-op the react-server build uses.
      "server-only": new URL("./node_modules/server-only/empty.js", import.meta.url).pathname,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Service tests boot an in-memory PGlite and apply every migration, which takes a few
    // seconds of WASM start-up before the first assertion runs.
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});

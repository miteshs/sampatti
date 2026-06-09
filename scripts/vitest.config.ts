import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone config for the import-coverage harness, so it runs in a Node environment and
// stays out of the app's unit-test suite (`npm test`) and the build's type-check.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["scripts/**/*.test.ts"],
    environment: "node",
  },
});

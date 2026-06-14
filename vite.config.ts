import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// Single source of truth for the in-app version: package.json (kept in sync with Cargo.toml +
// tauri.conf.json at release). Exposed as the global __APP_VERSION__ (see src/vite-env.d.ts).
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Tauri expects a fixed port and ignores the src-tauri folder while watching.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 1420, strictPort: false },
  // Vitest config lives here so we don't need a second file.
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

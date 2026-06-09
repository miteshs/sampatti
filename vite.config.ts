import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and ignores the src-tauri folder while watching.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: false },
  // Vitest config lives here so we don't need a second file.
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

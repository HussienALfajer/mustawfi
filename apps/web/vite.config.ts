import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * The tenant web client (ADR-0023). `/api` is proxied to the server so the app and the API
 * share one origin: the session cookie is first-party and the server's Origin check holds
 * (ADR-0022). The proxy keeps the browser's `Host`, which that check compares with `Origin`.
 */
const apiUrl = process.env["MUSTAWFI_API_URL"] ?? "http://127.0.0.1:3000";
const proxy = { "/api": { target: apiUrl } };

/**
 * The Windows app's build (`--mode desktop`) must know the server's origin: without it the app
 * would call its own origin, where no API answers. Refuse to build rather than ship that.
 */
function checkDesktopOrigin(mode: string): void {
  if (mode !== "desktop") return;
  const origin = loadEnv(mode, import.meta.dirname, "VITE_")["VITE_MUSTAWFI_API_ORIGIN"] ?? "";
  const url = URL.parse(origin);
  if (url === null || !/^https?:$/.test(url.protocol) || url.origin !== origin) {
    throw new Error(`VITE_MUSTAWFI_API_ORIGIN must be the server's origin, got "${origin}"`);
  }
}

export default defineConfig(({ mode }) => {
  checkDesktopOrigin(mode);
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy },
    preview: { proxy },
    // SQLite WASM loads its `.wasm` next to itself; pre-bundling would move the module away from it.
    optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
    worker: { format: "es" },
  };
});

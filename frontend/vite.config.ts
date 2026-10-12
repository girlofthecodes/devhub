import { Agent } from "node:http";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const proxyTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:8000";
const usePolling = process.env.VITE_USE_POLLING === "true";
// Reuse upstream connections: avoids a DNS lookup + TCP handshake per proxied request.
const proxyAgent = new Agent({ keepAlive: true, maxSockets: 32 });

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
    // Same-origin API: session + CSRF cookies work without CORS.
    proxy: {
      "/api": { target: proxyTarget, changeOrigin: false, xfwd: true, agent: proxyAgent },
      "/media": { target: proxyTarget, changeOrigin: false, agent: proxyAgent },
    },
  },
});

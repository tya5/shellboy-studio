import { defineConfig } from "vite";

// Node is needed at build time only. The output in web/dist is embedded into the bridge.
export default defineConfig({
  root: "app",
  publicDir: "public",
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsDir: "assets",
    modulePreload: { polyfill: false },
    target: "es2022",
    sourcemap: false,
  },
  server: {
    proxy: { "/ws": { target: "ws://127.0.0.1:8751", ws: true }, "/auth": "http://127.0.0.1:8751" },
  },
});

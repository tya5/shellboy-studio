import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Emit only the approved brand SVG/PNG files, not generator scripts or private files.
const brandFiles = ["studio-teal-master.svg", "studio-teal-16.svg", "studio-teal-32.svg", ...[16, 32, 48, 180, 192, 512].map(size => `studio-teal-${size}.png`)];
const publicRoot = fileURLToPath(new URL("./app/public/", import.meta.url));

// Node is needed at build time only. The output in web/dist is embedded into the bridge.
export default defineConfig({
  root: "app",
  publicDir: false,
  plugins: [{
    name: "approved-studio-brand",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        const name = path?.startsWith("/assets/brand/") ? path.slice("/assets/brand/".length) : undefined;
        const file = name && brandFiles.includes(name) ? `brand/${name}` : path === "/assets/manifest.webmanifest" ? "manifest.webmanifest" : undefined;
        if (!file) return next();
        res.setHeader("Content-Type", file.endsWith(".png") ? "image/png" : file.endsWith(".svg") ? "image/svg+xml" : "application/manifest+json");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(readFileSync(`${publicRoot}${file}`));
      });
    },
    generateBundle() {
      for (const name of brandFiles) this.emitFile({ type: "asset", fileName: `assets/brand/${name}`, source: readFileSync(`${publicRoot}brand/${name}`) });
      this.emitFile({ type: "asset", fileName: "assets/manifest.webmanifest", source: readFileSync(`${publicRoot}manifest.webmanifest`) });
    },
  }],
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

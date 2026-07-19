import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

function schemaAssets(): Plugin {
  return {
    name: "schema-assets",
    generateBundle() {
      const dir = resolve(import.meta.dirname, "src/main/db/schema");
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".sql")) continue;
        this.emitFile({
          type: "asset",
          fileName: `schema/${file}`,
          source: readFileSync(resolve(dir, file), "utf8"),
        });
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), schemaAssets()],
  },
  preload: {
    // No externalizeDepsPlugin here: a sandboxed preload cannot require
    // node_modules at runtime, so every dependency must be bundled in.
    build: {
      rollupOptions: {
        // Sandboxed preloads must be CommonJS; ESM preloads fail to load
        // silently and leave the renderer without the okami bridge.
        output: { format: "cjs", entryFileNames: "index.js" },
      },
    },
  },
  renderer: {
    root: ".",
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "index.html"),
      },
    },
  },
});

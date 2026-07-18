import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

function phaseOneSchemaAsset(): Plugin {
  return {
    name: "phase-one-schema-asset",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "schema/001-phase1-core.sql",
        source: readFileSync(
          resolve(
            import.meta.dirname,
            "src/main/db/schema/001-phase1-core.sql",
          ),
          "utf8",
        ),
      });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), phaseOneSchemaAsset()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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

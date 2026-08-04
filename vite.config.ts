import { defineConfig } from "vite";

export default defineConfig({
  // `examples/` is served as-is so the dev page can fetch a .voyage.json by URL,
  // the same way a consumer of the published format would.
  publicDir: "examples",
  build: { outDir: "dist", emptyOutDir: true },
});

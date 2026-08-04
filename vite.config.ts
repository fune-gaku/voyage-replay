import { defineConfig } from "vite";

export default defineConfig({
  // Relative, so the build works from a subdirectory or straight off the filesystem
  // rather than only from the root of a domain.
  base: "./",
  // `examples/` is served as-is so the dev page can fetch a .voyage.json by URL,
  // the same way a consumer of the published format would.
  publicDir: "examples",
  build: { outDir: "dist", emptyOutDir: true },
});

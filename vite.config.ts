import { readFile, stat } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

import { defineConfig, type Plugin } from "vite";

const SCENARIOS_DIR = resolve(import.meta.dirname, "scenarios");

/**
 * Serve and watch `scenarios/`, which is untracked and therefore invisible to Vite's
 * `publicDir`.
 *
 * The working corpus is kept out of the repository on purpose (see scenarios/README.md),
 * but the edit-and-see-it loop is the whole reason to run a dev server at all: correcting
 * an extraction means changing a number and watching whether the ship still does something
 * a ship could do. So the directory is served AND watched — a save reloads the page.
 */
function scenariosPlugin(): Plugin {
  return {
    name: "voyage-replay:scenarios",
    configureServer(server) {
      server.watcher.add(SCENARIOS_DIR);
      server.watcher.on("change", (file) => {
        if (normalize(file).startsWith(SCENARIOS_DIR)) {
          server.ws.send({ type: "full-reload" });
        }
      });

      server.middlewares.use("/scenarios", (request, response) => {
        const requested = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
        const target = normalize(join(SCENARIOS_DIR, requested));
        // Refuse anything that climbs out of the directory. This server is local, but a
        // path traversal here would hand out arbitrary files to any page in the browser.
        if (!target.startsWith(SCENARIOS_DIR)) {
          response.statusCode = 403;
          response.end("outside scenarios/");
          return;
        }

        void (async () => {
          try {
            const info = await stat(target);
            if (!info.isFile()) throw new Error("not a file");
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            response.end(await readFile(target));
          } catch {
            // Answer here rather than calling next(). Vite's fallback would serve
            // index.html with a 200, so a mistyped scenario name arrives at the page as
            // HTML and surfaces as a JSON parse error - which says nothing about the
            // actual mistake.
            response.statusCode = 404;
            response.setHeader("Content-Type", "text/plain; charset=utf-8");
            response.end(`no such scenario: scenarios${requested}`);
          }
        })();
      });
    },
  };
}

export default defineConfig({
  // Relative, so the build works from a subdirectory or straight off the filesystem
  // rather than only from the root of a domain.
  base: "./",
  // `examples/` is served as-is so the dev page can fetch a .voyage.json by URL,
  // the same way a consumer of the published format would.
  publicDir: "examples",
  plugins: [scenariosPlugin()],
  build: { outDir: "dist", emptyOutDir: true },
});

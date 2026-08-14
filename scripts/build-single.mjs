#!/usr/bin/env node
/**
 * Build one self-contained HTML file: the player, the styles and the scenario, all in it.
 *
 *   npm run build:single -- examples/suo-nada-2025-11-27.voyage.json
 *   npm run build:single -- <scenario.voyage.json> [-o out.html]
 *
 * The ordinary build is not enough for this. `dist/index.html` loads its JavaScript from a
 * sibling file and fetches the scenario over HTTP, and both fail under file:// - so the
 * result needs a web server, which is a lot of ceremony for looking at one reconstruction.
 *
 * What comes out here opens by double-clicking it. It can be attached to an email, dropped
 * into an article, or archived next to the video it produced, and it will still open in ten
 * years because everything it needs is inside it. That property is the point: a
 * reconstruction whose viewer has rotted is not evidence of anything.
 *
 * The cost is size - three.js travels inside every file - which is accepted. A few hundred
 * kilobytes is nothing against a video, and a CDN reference would trade the one property
 * worth having for it.
 *
 * ONE thing is deliberately outside: the map tiles under the plan view, which the page
 * fetches when it is opened (see src/render/basemap.ts for why - licence and size, in that
 * order). The check below therefore still means what it always did, and is worth reading
 * precisely: nothing may be left that the page needs in order to WORK. Offline, the
 * reconstruction runs exactly as it did before there was a map, with water and a grid where
 * the land was. A decoration that did not load is not a viewer that has rotted.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const outFlag = args.indexOf("-o");
const outPath = outFlag === -1 ? null : args[outFlag + 1];
// Skip the value that belongs to -o, but only when -o is actually present: with no flag
// outFlag is -1, and outFlag + 1 is 0, which would silently discard the first argument.
const outValueIndex = outFlag === -1 ? -1 : outFlag + 1;
const scenarioArg = args.find((a, i) => !a.startsWith("-") && i !== outValueIndex);

if (!scenarioArg) {
  console.error("usage: npm run build:single -- <scenario.voyage.json> [-o out.html]");
  process.exit(2);
}

const scenarioPath = resolve(scenarioArg);
const scenarioText = readFileSync(scenarioPath, "utf8");

// Fail before building rather than after: an unparseable scenario produces an HTML file
// that looks fine until someone opens it.
JSON.parse(scenarioText);

console.log(`building…`);
execFileSync("npx", ["vite", "build"], { cwd: repoRoot, stdio: "inherit" });

const distDir = join(repoRoot, "dist");
const html = readFileSync(join(distDir, "index.html"), "utf8");

const assetsDir = join(distDir, "assets");
const bundleName = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
if (!bundleName) throw new Error("no JavaScript bundle in dist/assets");
const bundle = readFileSync(join(assetsDir, bundleName), "utf8");

/**
 * Inside a <script>, the parser ends the element at the first `</script`, wherever it
 * appears - including in a string or a regex. Escaping the slash keeps it valid JavaScript
 * and invisible to the parser. `<!--` is the same trap in the other direction.
 */
const forScript = (text) => text.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** JSON has no escape for `/`, so the `<` is escaped instead - still valid JSON. */
const forJson = (text) => text.replace(/</g, "\\u003c");

// The replacements MUST be functions, not strings.
//
// String.prototype.replace expands `$&`, `` $` ``, `$'` and `$1` inside a replacement
// STRING - and minified JavaScript is full of those sequences. A bundle containing `$'`
// silently splices the entire remainder of the document back in at that point, which
// produced a 725 kB file that looked plausible, still had a script tag pointing at
// ./assets/, and would not have opened. A replacer function is passed through verbatim.
let single = html.replace(
  /<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/,
  () => `<script type="module">\n${forScript(bundle)}\n</script>`,
);
if (single === html) throw new Error("did not find the module script tag to inline");

const before = single;
single = single.replace(
  /(<script type="application\/json" id="scenario">)(<\/script>)/,
  (_match, open, close) => `${open}\n${forJson(scenarioText.trim())}\n${close}`,
);
if (single === before) throw new Error("did not find the scenario placeholder to fill");

// Nothing the page needs in order to load may be left pointing outside the file, or the
// whole point is lost. Tags are what this looks at, which is exactly the right scope: a
// script or a stylesheet fetched here is a page that does not open, while the tile URLs the
// renderer builds at run time are a map that may or may not arrive.
const leftovers = [
  ...single.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)="([^"]+)"/g),
]
  .map((m) => m[1])
  .filter((url) => !url.startsWith("data:") && !url.startsWith("#"));
if (leftovers.length > 0) {
  throw new Error(`still references external files: ${[...new Set(leftovers)].join(", ")}`);
}

const target = outPath
  ? resolve(outPath)
  : join(repoRoot, "dist", basename(scenarioPath).replace(/\.voyage\.json$/, "") + ".html");

writeFileSync(target, single);

const kilobytes = Math.round(Buffer.byteLength(single) / 1024);
console.log(`\nwrote ${target} (${kilobytes} kB, self-contained)`);
console.log("open it directly - no server needed.");
console.log("the map under the plan view is fetched on opening; offline it draws water.");

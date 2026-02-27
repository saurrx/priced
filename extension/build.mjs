import { build, context } from "esbuild";
import { readFileSync } from "fs";

const isWatch = process.argv.includes("--watch");

const config = {
  entryPoints: ["src/content/index.ts"],
  bundle: true,
  outfile: "dist/content.js",
  target: "chrome120",
  format: "iife",
  minify: !isWatch,
  sourcemap: isWatch,
  loader: { ".json": "json" },
};

if (isWatch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await build(config);
  const size = readFileSync("dist/content.js").length;
  console.log(`Built dist/content.js (${(size / 1024).toFixed(1)} KB)`);
}

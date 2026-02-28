import { build, context } from "esbuild";
import { readFileSync } from "fs";

const isWatch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  target: "chrome120",
  format: "iife",
  minify: !isWatch,
  sourcemap: isWatch,
  loader: { ".json": "json" },
};

const contentConfig = {
  ...shared,
  entryPoints: ["src/content/index.ts"],
  outfile: "dist/content.js",
};

const popupConfig = {
  ...shared,
  entryPoints: ["src/popup.ts"],
  outfile: "dist/popup.js",
};

if (isWatch) {
  const ctx1 = await context(contentConfig);
  const ctx2 = await context(popupConfig);
  await ctx1.watch();
  await ctx2.watch();
  console.log("Watching for changes...");
} else {
  await build(contentConfig);
  await build(popupConfig);
  const contentSize = readFileSync("dist/content.js").length;
  const popupSize = readFileSync("dist/popup.js").length;
  console.log(`Built dist/content.js (${(contentSize / 1024).toFixed(1)} KB)`);
  console.log(`Built dist/popup.js (${(popupSize / 1024).toFixed(1)} KB)`);
}

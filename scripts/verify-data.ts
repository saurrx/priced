import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(readFileSync(join(__dirname, "..", "data", "markets-snapshot.json"), "utf-8"));
const analysis = JSON.parse(readFileSync(join(__dirname, "..", "data", "market-analysis.json"), "utf-8"));

const markets: any[] = Object.values(snapshot.markets);
const events = Object.entries(snapshot.events) as [string, any][];

console.log("=== SNAPSHOT VERIFICATION ===");
console.log("Markets:", markets.length);
console.log("Events:", events.length);

const nullMints = markets.filter((m) => !m.yesMint || !m.noMint);
console.log("Null yesMint/noMint:", nullMints.length);

const noCategory = markets.filter((m) => !m.category || m.category === "Unknown");
console.log("Missing/Unknown category:", noCategory.length);
if (noCategory.length > 0 && noCategory.length <= 10) {
  console.log("  Tickers:", noCategory.map((m) => m.ticker).join(", "));
}

const brokenLinks = markets.filter((m) => !snapshot.events[m.eventTicker]);
console.log("Broken market->event links:", brokenLinks.length);

const orphanEvents = events.filter(([, e]) => e.markets.some((mt: string) => !snapshot.markets[mt]));
console.log("Events with orphan market refs:", orphanEvents.length);

console.log("Market fields:", Object.keys(markets[0]).join(", "));

console.log("");
console.log("=== ANALYSIS VERIFICATION ===");
console.log("Top-level keys:", Object.keys(analysis).join(", "));

const entities = analysis.entities || [];
console.log("Entities:", entities.length);
const unique = entities.filter((e: any) => e.eventTickers.length === 1).length;
const ambig = entities.filter((e: any) => e.eventTickers.length > 1).length;
console.log("  Unique (1 event):", unique);
console.log("  Ambiguous (2+ events):", ambig);

console.log("Collision clusters:", analysis.collisions?.length ?? "MISSING");
if (analysis.collisions) {
  console.log("  Top 5:", analysis.collisions.slice(0, 5).map((c: any) => `${c.name}`).join(", "));
}

console.log("Keywords:", analysis.keywords?.length ?? "MISSING");
console.log("Matchability scores:", analysis.matchability?.length ?? "MISSING");
console.log("Semantic clusters:", analysis.semanticClusters?.length ?? "MISSING");
console.log("Spread analysis:", analysis.spreadAnalysis ? "present" : "MISSING");
console.log("Event sizes:", analysis.eventSizes ? "present" : "MISSING");
console.log("Category strategies:", analysis.categoryStrategies?.length ?? "MISSING");

// Cross-validate: do all entity eventTickers exist in snapshot?
let badEntityRefs = 0;
for (const ent of entities) {
  for (const et of ent.eventTickers) {
    if (!snapshot.events[et]) badEntityRefs++;
  }
}
console.log("Entity refs to missing events:", badEntityRefs);

// Check entity types
const typeCounts: Record<string, number> = {};
for (const e of entities) {
  typeCounts[e.entityType] = (typeCounts[e.entityType] || 0) + 1;
}
console.log("Entity type breakdown:", JSON.stringify(typeCounts));

console.log("");
if (nullMints.length === 0 && brokenLinks.length === 0 && orphanEvents.length === 0 && badEntityRefs === 0) {
  console.log("=== ALL CHECKS PASSED ===");
} else {
  console.log("=== ISSUES FOUND - FIX BEFORE PROCEEDING ===");
}

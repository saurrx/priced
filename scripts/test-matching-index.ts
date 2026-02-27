import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const snapshot = JSON.parse(readFileSync(join(__dirname, "..", "data", "markets-snapshot.json"), "utf-8"));
const index = JSON.parse(readFileSync(join(__dirname, "..", "data", "matching-index.json"), "utf-8"));
const descriptions = JSON.parse(readFileSync(join(__dirname, "..", "data", "event-descriptions.json"), "utf-8"));

const events = snapshot.events;
const markets = snapshot.markets;

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
  try {
    if (fn()) {
      console.log(`  \u2705 ${name}`);
      passed++;
    } else {
      console.log(`  \u274C ${name}`);
      failed++;
    }
  } catch (e: any) {
    console.log(`  \u274C ${name} — ${e.message}`);
    failed++;
  }
}

console.log("=== MATCHING INDEX TESTS ===");
console.log("");

// Schema validation
test("matching-index.json has version field", () => index.version === 1);
test("matching-index.json has generatedAt", () => typeof index.generatedAt === "string");
test("matching-index.json has stats", () => typeof index.stats === "object");
test("matching-index.json has unique map", () => typeof index.unique === "object");
test("matching-index.json has ambiguous map", () => typeof index.ambiguous === "object");
test("matching-index.json has bigrams map", () => typeof index.bigrams === "object");
test("matching-index.json has aliases map", () => typeof index.aliases === "object");

// Unique entity validation
test("All unique entities reference valid events", () => {
  for (const [, data] of Object.entries(index.unique) as any) {
    if (!events[data.eventTicker]) return false;
  }
  return true;
});

test("All unique entities have marketTickers array", () => {
  for (const [, data] of Object.entries(index.unique) as any) {
    if (!Array.isArray(data.marketTickers)) return false;
  }
  return true;
});

test("All unique entity marketTickers exist in snapshot", () => {
  let bad = 0;
  for (const [, data] of Object.entries(index.unique) as any) {
    for (const mt of data.marketTickers) {
      if (!markets[mt]) bad++;
    }
  }
  return bad === 0;
});

// Ambiguous entity validation
test("All ambiguous entities reference valid events", () => {
  for (const [, tickers] of Object.entries(index.ambiguous) as any) {
    for (const t of tickers) {
      if (!events[t]) return false;
    }
  }
  return true;
});

test("All ambiguous entities have 2+ events", () => {
  for (const [, tickers] of Object.entries(index.ambiguous) as any) {
    if (tickers.length < 2) return false;
  }
  return true;
});

// No overlap
test("No overlap between unique and ambiguous keys", () => {
  for (const key of Object.keys(index.unique)) {
    if (index.ambiguous[key]) return false;
  }
  return true;
});

// Bigram validation
test("All bigram targets are valid events", () => {
  for (const [, ticker] of Object.entries(index.bigrams) as any) {
    if (!events[ticker]) return false;
  }
  return true;
});

// Alias validation
test("Alias targets exist in unique or ambiguous or event titles", () => {
  let bad = 0;
  for (const [alias, target] of Object.entries(index.aliases) as any) {
    const inUnique = !!index.unique[target];
    const inAmbiguous = !!index.ambiguous[target];
    const inTitles = Object.values(events).some((e: any) =>
      e.title.toLowerCase().includes(target)
    );
    if (!inUnique && !inAmbiguous && !inTitles) bad++;
  }
  return bad === 0;
});

// Stats consistency
test("Stats match actual counts", () => {
  return index.stats.uniqueEntities === Object.keys(index.unique).length &&
    index.stats.ambiguousEntities === Object.keys(index.ambiguous).length &&
    index.stats.bigrams === Object.keys(index.bigrams).length &&
    index.stats.aliases === Object.keys(index.aliases).length;
});

// Entity count expectations
test("Unique entities ~600-800 range", () => {
  const count = Object.keys(index.unique).length;
  return count >= 500 && count <= 900;
});

test("Ambiguous entities ~150-350 range", () => {
  const count = Object.keys(index.ambiguous).length;
  return count >= 100 && count <= 400;
});

console.log("");
console.log("=== EVENT DESCRIPTIONS TESTS ===");
console.log("");

test("event-descriptions.json has version field", () => descriptions.version === 1);
test("event-descriptions.json has events array", () => Array.isArray(descriptions.events));

test("Has exactly 395 event descriptions", () => descriptions.events.length === Object.keys(events).length);

test("No empty descriptions", () => {
  return descriptions.events.every((d: any) =>
    d.enrichedDescription && d.enrichedDescription.trim().length > 0
  );
});

test("No description exceeds 150 words", () => {
  return descriptions.events.every((d: any) =>
    d.enrichedDescription.split(/\s+/).length <= 150
  );
});

test("Every eventTicker exists in snapshot", () => {
  return descriptions.events.every((d: any) => !!events[d.eventTicker]);
});

test("Every snapshot event has a description", () => {
  const described = new Set(descriptions.events.map((d: any) => d.eventTicker));
  return Object.keys(events).every((t) => described.has(t));
});

test("All descriptions have category field", () => {
  return descriptions.events.every((d: any) => typeof d.category === "string" && d.category.length > 0);
});

test("All descriptions have marketTickers array", () => {
  return descriptions.events.every((d: any) => Array.isArray(d.marketTickers) && d.marketTickers.length > 0);
});

test("All descriptions have topEntities array", () => {
  return descriptions.events.every((d: any) => Array.isArray(d.topEntities));
});

console.log("");
console.log("=".repeat(50));
console.log(`  ${passed} passed, ${failed} failed`);
console.log("=".repeat(50));

if (failed > 0) process.exit(1);

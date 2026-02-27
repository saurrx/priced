import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_PATH = join(__dirname, "tweet-test-suite.json");
const INDEX_PATH = join(__dirname, "..", "data", "matching-index.json");
const BACKEND_URL = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Minimal EntityMatcher (same logic as extension, but for Node.js)
// ---------------------------------------------------------------------------

interface MatchingIndex {
  unique: Record<string, { eventTicker: string }>;
  ambiguous: Record<string, string[]>;
  bigrams: Record<string, string>;
  aliases: Record<string, string>;
}

interface EntityResult {
  type: "unique" | "ambiguous" | "bigram";
  eventTicker?: string;
  candidateTickers?: string[];
  confidence: number;
  matchedEntity: string;
}

function wordBoundaryMatch(text: string, entity: string): boolean {
  const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s|[^a-z0-9])${escaped}(?:$|\\s|[^a-z0-9])`, "i");
  return re.test(text);
}

function entityMatch(text: string, index: MatchingIndex): EntityResult | null {
  const normalized = text.toLowerCase().replace(/[^\w\s$@#\-]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < 3) return null;

  const tokens = normalized.split(/\s+/);
  const expanded = tokens.map((t) => index.aliases[t] || t);
  const expandedText = expanded.join(" ");

  // Bigrams
  for (let i = 0; i < expanded.length - 1; i++) {
    const bg = `${expanded[i]} ${expanded[i + 1]}`;
    if (index.bigrams[bg]) {
      return { type: "bigram", eventTicker: index.bigrams[bg], confidence: 0.95, matchedEntity: bg };
    }
  }

  // Unique (sorted by length desc)
  const sortedUnique = Object.entries(index.unique).sort((a, b) => b[0].length - a[0].length);
  for (const [entity, data] of sortedUnique) {
    if (wordBoundaryMatch(expandedText, entity) || wordBoundaryMatch(normalized, entity)) {
      return { type: "unique", eventTicker: data.eventTicker, confidence: 0.9, matchedEntity: entity };
    }
  }

  // Ambiguous
  const candidates = new Set<string>();
  for (const [entity, tickers] of Object.entries(index.ambiguous)) {
    if (wordBoundaryMatch(expandedText, entity) || wordBoundaryMatch(normalized, entity)) {
      tickers.forEach((t) => candidates.add(t));
    }
  }
  if (candidates.size > 0) {
    return { type: "ambiguous", candidateTickers: [...candidates], confidence: 0.5, matchedEntity: "multiple" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Backend match call
// ---------------------------------------------------------------------------

async function backendMatch(
  tweets: { id: string; text: string }[],
  candidates?: Record<string, string[]>
): Promise<{ id: string; eventTicker: string; confidence: number }[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tweets, candidates: candidates || null }),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.matches.map((m: any) => ({
      id: m.id,
      eventTicker: m.eventTicker,
      confidence: m.confidence,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Run suite
// ---------------------------------------------------------------------------

async function main() {
  const suite = JSON.parse(readFileSync(SUITE_PATH, "utf-8"));
  const index: MatchingIndex = JSON.parse(readFileSync(INDEX_PATH, "utf-8"));

  const tests = suite.tests;
  console.log(`Running ${tests.length} tweet tests...\n`);

  // Check backend health
  let backendUp = false;
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    backendUp = res.ok;
  } catch {}
  console.log(`Backend: ${backendUp ? "UP" : "DOWN (skipping semantic tests)"}\n`);

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const failures: string[] = [];

  for (const test of tests) {
    const expectMatch = test.expectEvent !== null && test.expectEventPattern !== undefined;
    const expectNonMatch = test.expectEvent === null && !test.expectEventPattern;

    // 1. Entity match
    const entityResult = entityMatch(test.text, index);

    // 2. Backend match (if available)
    let backendResult: { eventTicker: string; confidence: number } | null = null;
    if (backendUp) {
      const candidates = entityResult?.type === "ambiguous" ? { "test": entityResult.candidateTickers! } : undefined;
      const results = await backendMatch([{ id: "test", text: test.text }], candidates);
      backendResult = results.find((r) => r.id === "test") || null;
    }

    // Pick best result
    let bestTicker: string | null = null;
    let bestConfidence = 0;
    let source = "none";

    if (entityResult?.eventTicker && entityResult.confidence > bestConfidence) {
      bestTicker = entityResult.eventTicker;
      bestConfidence = entityResult.confidence;
      source = `entity(${entityResult.type})`;
    } else if (entityResult?.type === "ambiguous" && entityResult.candidateTickers && entityResult.candidateTickers.length > 0 && entityResult.confidence > bestConfidence) {
      // For ambiguous matches, use first candidate as representative ticker
      bestTicker = entityResult.candidateTickers[0];
      bestConfidence = entityResult.confidence;
      source = `entity(ambiguous:${entityResult.candidateTickers.length})`;
    }
    if (backendResult && backendResult.confidence > bestConfidence) {
      bestTicker = backendResult.eventTicker;
      bestConfidence = backendResult.confidence;
      source = "backend";
    }

    // Evaluate
    if (expectNonMatch) {
      if (!bestTicker) {
        tn++;
        // console.log(`  TN: "${test.text.slice(0, 40)}..." → no match ✓`);
      } else {
        fp++;
        const msg = `  FP: "${test.text.slice(0, 50)}..." → ${bestTicker} (${bestConfidence.toFixed(2)}) via ${source} [should be no match]`;
        console.log(msg);
        failures.push(msg);
      }
    } else if (expectMatch) {
      const pattern = new RegExp(test.expectEventPattern, "i");
      if (bestTicker && pattern.test(bestTicker)) {
        tp++;
        // console.log(`  TP: "${test.text.slice(0, 40)}..." → ${bestTicker} ✓`);
      } else if (bestTicker) {
        // Matched something, but wrong event
        fp++;
        const msg = `  FP: "${test.text.slice(0, 50)}..." → ${bestTicker} (${bestConfidence.toFixed(2)}) via ${source} [expected /${test.expectEventPattern}/]`;
        console.log(msg);
        failures.push(msg);
      } else {
        fn++;
        const msg = `  FN: "${test.text.slice(0, 50)}..." → no match [expected /${test.expectEventPattern}/]`;
        console.log(msg);
        failures.push(msg);
      }
    }
  }

  const total = tp + fp + tn + fn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  console.log("");
  console.log("=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));
  console.log(`  Total tests:    ${total}`);
  console.log(`  True positives: ${tp}`);
  console.log(`  True negatives: ${tn}`);
  console.log(`  False positives:${fp}`);
  console.log(`  False negatives:${fn}`);
  console.log(`  Precision:      ${(precision * 100).toFixed(1)}%  (target: >90%)`);
  console.log(`  Recall:         ${(recall * 100).toFixed(1)}%  (target: >60%)`);
  console.log(`  F1:             ${(f1 * 100).toFixed(1)}%`);
  console.log("=".repeat(60));

  if (failures.length > 0) {
    console.log(`\n${failures.length} failures found. Review above for details.`);
  }

  if (fp > 0 && precision < 0.9) {
    console.log("\nPrecision below 90% — consider raising confidence threshold.");
  }
  if (fn > 0 && recall < 0.6) {
    console.log("\nRecall below 60% — consider adding more entities/aliases.");
  }
}

main().catch(console.error);

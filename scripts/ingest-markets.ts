import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const DFLOW_BASE = "https://dev-prediction-markets-api.dflow.net/api/v1";
const VOLUME_THRESHOLD = 50_000; // $50K in contracts (each $1 notional)
const PAGE_SIZE = 200;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAX_RETRIES = 3;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "data", "markets-snapshot.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DFlowMarket {
  ticker: string;
  eventTicker: string;
  title: string;
  subtitle: string;
  yesSubTitle: string;
  noSubTitle: string;
  status: string;
  yesBid: string | null;
  yesAsk: string | null;
  noBid: string | null;
  noAsk: string | null;
  volume: number;
  openInterest: number;
  closeTime: number; // Unix timestamp (seconds)
  expirationTime: number;
  openTime: number;
  rulesPrimary: string;
  canCloseEarly: boolean;
  accounts: Record<string, {
    marketLedger: string;
    yesMint: string;
    noMint: string;
    isInitialized: boolean;
    redemptionStatus: string | null;
  }>;
}

interface DFlowEvent {
  eventTicker: string;
  title: string;
  subtitle: string;
  seriesTicker: string;
  markets: DFlowMarket[];
}

interface FlatMarket {
  ticker: string;
  eventTicker: string;
  title: string;
  subtitle: string;
  yesSubTitle: string;
  noSubTitle: string;
  eventTitle: string;
  eventSubtitle: string;
  category: string;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  volume: number;
  openInterest: number;
  closeTime: string; // ISO 8601 (converted from Unix)
  expirationTime: string;
  openTime: string;
  rulesPrimary: string;
  canCloseEarly: boolean;
  yesMint: string;
  noMint: string;
  marketLedger: string;
  isInitialized: boolean;
}

interface EventEntry {
  title: string;
  subtitle: string;
  category: string;
  markets: string[];
}

interface Snapshot {
  meta: {
    snapshotDate: string;
    version: number;
    source: string;
    dflowEventsTotal: number;
    dflowMarketsTotal: number;
    filteredMarkets: number;
    initializedMarkets: number;
    uninitializedMarkets: number;
    allTradeable: boolean;
    volumeThreshold: number;
    categories: Record<string, number>;
    ingestionTimeMs: number;
  };
  events: Record<string, EventEntry>;
  markets: Record<string, FlatMarket>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[INGEST] ${msg}`);
}

function warn(msg: string) {
  console.warn(`[INGEST] WARN: ${msg}`);
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "2", 10);
        log(`Rate limited. Waiting ${retryAfter}s... (attempt ${attempt}/${retries})`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    } catch (err: any) {
      if (attempt === retries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      log(`Network error: ${err.message}. Retrying in ${delay / 1000}s... (attempt ${attempt}/${retries})`);
      await sleep(delay);
    }
  }
  throw new Error("Unreachable");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Step 1a: Fetch all active events from DFlow (primary source)
// ---------------------------------------------------------------------------

async function fetchDFlowEvents(): Promise<DFlowEvent[]> {
  log("Step 1: Fetching DFlow events (withNestedMarkets=true)...");
  const t0 = Date.now();
  const allEvents: DFlowEvent[] = [];
  let cursor: string | null = null;
  let page = 0;
  let totalMarkets = 0;

  while (true) {
    page++;
    let url = `${DFLOW_BASE}/events?withNestedMarkets=true&status=active&limit=${PAGE_SIZE}`;
    if (cursor) url += `&cursor=${cursor}`;

    const res = await fetchWithRetry(url);
    let data: any;
    try {
      data = await res.json();
    } catch {
      warn(`Invalid JSON on page ${page}, skipping`);
      break;
    }

    const events: DFlowEvent[] = data.events || [];
    allEvents.push(...events);

    const nestedCount = events.reduce((s, e) => s + (e.markets?.length || 0), 0);
    totalMarkets += nestedCount;
    cursor = data.cursor || null;

    log(`Page ${page}/?: ${events.length} events, ${nestedCount.toLocaleString()} markets fetched (${allEvents.length.toLocaleString()} events total) [${((Date.now() - t0) / 1000).toFixed(1)}s]`);

    if (!cursor || events.length === 0) break;
  }

  log(`Step 1 complete: ${allEvents.length.toLocaleString()} events, ${totalMarkets.toLocaleString()} markets in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return allEvents;
}

// ---------------------------------------------------------------------------
// Step 1b: Fetch Kalshi events in parallel (for categories only)
// ---------------------------------------------------------------------------

async function fetchKalshiCategories(): Promise<Map<string, string>> {
  log("Step 1 (parallel): Fetching Kalshi events for categories...");
  const t0 = Date.now();
  const categoryMap = new Map<string, string>(); // eventTicker -> category
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    page++;
    let url = `${KALSHI_BASE}/events?status=open&with_nested_markets=false&limit=${PAGE_SIZE}`;
    if (cursor) url += `&cursor=${cursor}`;

    try {
      const res = await fetchWithRetry(url);
      const data = await res.json() as any;
      const events = data.events || [];

      for (const e of events) {
        if (e.event_ticker && e.category) {
          categoryMap.set(e.event_ticker, e.category);
        }
      }

      cursor = data.cursor || null;
      if (!cursor || events.length === 0) break;
    } catch (err: any) {
      warn(`Kalshi category fetch failed on page ${page}: ${err.message}. Continuing with partial categories.`);
      break;
    }
  }

  log(`Kalshi categories fetched: ${categoryMap.size.toLocaleString()} events mapped in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return categoryMap;
}

// ---------------------------------------------------------------------------
// Step 2: Filter & flatten
// ---------------------------------------------------------------------------

function filterAndFlatten(
  events: DFlowEvent[],
  categoryMap: Map<string, string>
): { flatMarkets: FlatMarket[]; eventMap: Record<string, EventEntry>; dflowMarketsTotal: number } {
  log("Step 2: Filtering...");
  const now = new Date();
  const flatMarkets: FlatMarket[] = [];
  const eventMap: Record<string, EventEntry> = {};

  let rawCount = 0;
  let afterStatus = 0;
  let afterClose = 0;
  let afterVolume = 0;
  let droppedNoMints = 0;

  const nowSec = Math.floor(now.getTime() / 1000);

  for (const event of events) {
    for (const m of event.markets || []) {
      rawCount++;

      if (m.status !== "active") continue;
      afterStatus++;

      if (m.closeTime <= nowSec) continue;
      afterClose++;

      if (m.volume < VOLUME_THRESHOLD) continue;
      afterVolume++;

      // Extract mints — ALWAYS, regardless of isInitialized
      const usdcAccount = m.accounts?.[USDC_MINT];
      if (!usdcAccount?.yesMint || !usdcAccount?.noMint) {
        droppedNoMints++;
        warn(`Market ${m.ticker} has no USDC mints, skipping`);
        continue;
      }

      const category = categoryMap.get(m.eventTicker) || "Unknown";

      // Parse string prices to cents (e.g., "0.9400" -> 94)
      const parseCents = (v: string | null): number | null => {
        if (v == null) return null;
        return Math.round(parseFloat(v) * 100);
      };

      flatMarkets.push({
        ticker: m.ticker,
        eventTicker: m.eventTicker,
        title: m.title || "",
        subtitle: m.subtitle || "",
        yesSubTitle: m.yesSubTitle || "",
        noSubTitle: m.noSubTitle || "",
        eventTitle: event.title || "",
        eventSubtitle: event.subtitle || "",
        category,
        yesBid: parseCents(m.yesBid),
        yesAsk: parseCents(m.yesAsk),
        noBid: parseCents(m.noBid),
        noAsk: parseCents(m.noAsk),
        volume: m.volume,
        openInterest: m.openInterest,
        closeTime: new Date(m.closeTime * 1000).toISOString(),
        expirationTime: new Date(m.expirationTime * 1000).toISOString(),
        openTime: new Date(m.openTime * 1000).toISOString(),
        rulesPrimary: m.rulesPrimary || "",
        canCloseEarly: m.canCloseEarly ?? false,
        yesMint: usdcAccount.yesMint,
        noMint: usdcAccount.noMint,
        marketLedger: usdcAccount.marketLedger || "",
        isInitialized: usdcAccount.isInitialized ?? false,
      });

      // Build event map
      if (!eventMap[m.eventTicker]) {
        eventMap[m.eventTicker] = {
          title: event.title || "",
          subtitle: event.subtitle || "",
          category,
          markets: [],
        };
      }
      eventMap[m.eventTicker].markets.push(m.ticker);
    }
  }

  log(`  Raw markets: ${rawCount.toLocaleString()}`);
  log(`  After status=active: ${afterStatus.toLocaleString()}`);
  log(`  After closeTime > now: ${afterClose.toLocaleString()}`);
  log(`  After volume >= $${(VOLUME_THRESHOLD / 1000).toFixed(0)}K: ${afterVolume.toLocaleString()}`);
  log(`  After USDC mint check: ${flatMarkets.length.toLocaleString()} (${droppedNoMints} dropped)`);
  log(`Step 2 complete: ${flatMarkets.length.toLocaleString()} markets across ${Object.keys(eventMap).length.toLocaleString()} events`);

  return { flatMarkets, eventMap, dflowMarketsTotal: rawCount };
}

// ---------------------------------------------------------------------------
// Step 3: Validate & save
// ---------------------------------------------------------------------------

function validateAndSave(
  flatMarkets: FlatMarket[],
  eventMap: Record<string, EventEntry>,
  dflowEventsTotal: number,
  dflowMarketsTotal: number,
  ingestionTimeMs: number
): void {
  log("Step 3: Validating and saving...");

  // Validation
  const now = new Date();
  const seenTickers = new Set<string>();
  let issues = 0;

  for (const m of flatMarkets) {
    if (!m.title) { warn(`Market ${m.ticker} missing title`); issues++; }
    if (!m.eventTitle) { warn(`Market ${m.ticker} missing eventTitle`); issues++; }
    if (!m.category) { warn(`Market ${m.ticker} missing category`); issues++; }
    if (new Date(m.closeTime) <= now) { warn(`Market ${m.ticker} closeTime in the past`); issues++; }
    if (m.volume < VOLUME_THRESHOLD) { warn(`Market ${m.ticker} volume below threshold`); issues++; }
    if (!m.yesMint || !m.noMint) { warn(`Market ${m.ticker} missing mints`); issues++; }
    if (seenTickers.has(m.ticker)) { warn(`Duplicate ticker: ${m.ticker}`); issues++; }
    seenTickers.add(m.ticker);

    if (m.yesMint && (m.yesMint.length < 32 || m.yesMint.length > 44)) {
      warn(`Market ${m.ticker} yesMint invalid length: ${m.yesMint}`);
      issues++;
    }
    if (m.noMint && (m.noMint.length < 32 || m.noMint.length > 44)) {
      warn(`Market ${m.ticker} noMint invalid length: ${m.noMint}`);
      issues++;
    }

    // Check event linkage
    if (!eventMap[m.eventTicker]) {
      warn(`Market ${m.ticker} references missing event ${m.eventTicker}`);
      issues++;
    }
  }

  // Check reverse linkage: every event's market list should exist in markets
  const marketTickers = new Set(flatMarkets.map((m) => m.ticker));
  for (const [eventTicker, entry] of Object.entries(eventMap)) {
    for (const ticker of entry.markets) {
      if (!marketTickers.has(ticker)) {
        warn(`Event ${eventTicker} references missing market ${ticker}`);
        issues++;
      }
    }
  }

  if (issues === 0) {
    log("  All validation checks passed");
  } else {
    log(`  Validation completed with ${issues} warnings`);
  }

  // Category distribution
  const categories: Record<string, number> = {};
  for (const m of flatMarkets) {
    categories[m.category] = (categories[m.category] || 0) + 1;
  }
  const sortedCategories = Object.fromEntries(
    Object.entries(categories).sort(([, a], [, b]) => b - a)
  );

  const initialized = flatMarkets.filter((m) => m.isInitialized).length;
  const uninitialized = flatMarkets.length - initialized;

  // Build markets dict
  const marketsDict: Record<string, FlatMarket> = {};
  for (const m of flatMarkets) {
    marketsDict[m.ticker] = m;
  }

  const snapshot: Snapshot = {
    meta: {
      snapshotDate: new Date().toISOString(),
      version: 2,
      source: "dflow",
      dflowEventsTotal,
      dflowMarketsTotal,
      filteredMarkets: flatMarkets.length,
      initializedMarkets: initialized,
      uninitializedMarkets: uninitialized,
      allTradeable: true,
      volumeThreshold: VOLUME_THRESHOLD,
      categories: sortedCategories,
      ingestionTimeMs,
    },
    events: eventMap,
    markets: marketsDict,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));

  const fileSizeMB = (Buffer.byteLength(JSON.stringify(snapshot)) / (1024 * 1024)).toFixed(1);
  log(`  Output: data/markets-snapshot.json (${fileSizeMB} MB)`);
  log(`  ${flatMarkets.length.toLocaleString()} markets | ${Object.keys(eventMap).length.toLocaleString()} events | ${initialized.toLocaleString()} initialized | ${uninitialized.toLocaleString()} uninitialized`);
  log(`  All ${flatMarkets.length.toLocaleString()} tradeable via DFlow Trade API`);
  log(`Step 3 complete`);
}

// ---------------------------------------------------------------------------
// Verification summary
// ---------------------------------------------------------------------------

function printSummary(flatMarkets: FlatMarket[], ingestionTimeMs: number): void {
  const now = new Date();
  const tickers = flatMarkets.map((m) => m.ticker);
  const uniqueTickers = new Set(tickers);
  const allFuture = flatMarkets.every((m) => new Date(m.closeTime) > now);
  const allAboveThreshold = flatMarkets.every((m) => m.volume >= VOLUME_THRESHOLD);
  const allHaveMints = flatMarkets.every((m) => m.yesMint && m.noMint);
  const initialized = flatMarkets.filter((m) => m.isInitialized).length;
  const uninitialized = flatMarkets.length - initialized;
  const noDupes = uniqueTickers.size === tickers.length;

  const categories: Record<string, number> = {};
  for (const m of flatMarkets) {
    categories[m.category] = (categories[m.category] || 0) + 1;
  }
  const sortedCats = Object.entries(categories).sort(([, a], [, b]) => b - a);

  const fileSizeMB = "1.2"; // approximate, already written

  const topByVolume = flatMarkets.reduce((top, m) => (m.volume > top.volume ? m : top), flatMarkets[0]);
  const minVolume = flatMarkets.reduce((min, m) => (m.volume < min.volume ? m : min), flatMarkets[0]);

  const w = 56;
  const line = (s: string) => console.log(s);
  const pad = (s: string) => s.padEnd(w - 1) + "\u2551";

  line("");
  line("\u2554" + "\u2550".repeat(w) + "\u2557");
  line("\u2551" + pad("  INGESTION COMPLETE \u2014 v2"));
  line("\u2560" + "\u2550".repeat(w) + "\u2563");
  line("\u2551" + pad(`  Markets:     ${flatMarkets.length.toLocaleString().padStart(5)}  (all tradeable)`));
  line("\u2551" + pad(`  Events:      ${Object.keys(categories).length.toString().padStart(5)}`));
  line("\u2551" + pad(`  Initialized: ${initialized.toString().padStart(5)}  (instant trade)`));
  line("\u2551" + pad(`  Uninitialized:${uninitialized.toString().padStart(4)}  (auto-init on first trade)`));
  line("\u2551" + pad(`  Duration:    ${(ingestionTimeMs / 1000).toFixed(1)}s`));
  line("\u2560" + "\u2550".repeat(w) + "\u2563");
  line("\u2551" + pad("  CATEGORY BREAKDOWN"));
  for (const [cat, count] of sortedCats) {
    const pct = ((count / flatMarkets.length) * 100).toFixed(1);
    line("\u2551" + pad(`  ${cat.padEnd(20)} ${count.toString().padStart(5)}  (${pct.padStart(4)}%)`));
  }
  line("\u2560" + "\u2550".repeat(w) + "\u2563");
  line("\u2551" + pad("  VALIDATION"));
  line("\u2551" + pad(`  ${allHaveMints ? "\u2705" : "\u274C"} All markets have USDC yesMint + noMint`));
  line("\u2551" + pad(`  ${noDupes ? "\u2705" : "\u274C"} No duplicate tickers`));
  line("\u2551" + pad(`  ${allFuture ? "\u2705" : "\u274C"} All closeTimes in future`));
  line("\u2551" + pad(`  ${allAboveThreshold ? "\u2705" : "\u274C"} All volumes >= $50K`));
  line("\u255A" + "\u2550".repeat(w) + "\u255D");
  line("");
  line(`[VERIFY] Top market by volume: ${topByVolume.ticker} ($${(topByVolume.volume / 1_000_000).toFixed(1)}M)`);
  line(`[VERIFY] Smallest volume in set: $${(minVolume.volume / 1000).toFixed(1)}K`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  console.log("=".repeat(60));
  log("Market Data Ingestion v2 \u2014 Starting");
  console.log("=".repeat(60));

  // Step 1: Fetch DFlow events + Kalshi categories in parallel
  const [dflowEvents, categoryMap] = await Promise.all([
    fetchDFlowEvents(),
    fetchKalshiCategories(),
  ]);

  // Step 2: Filter & flatten
  const { flatMarkets, eventMap, dflowMarketsTotal } = filterAndFlatten(dflowEvents, categoryMap);

  if (flatMarkets.length === 0) {
    log("No markets passed filters. Nothing to save.");
    return;
  }

  // Step 3: Validate & save
  const ingestionTimeMs = Date.now() - t0;
  validateAndSave(flatMarkets, eventMap, dflowEvents.length, dflowMarketsTotal, ingestionTimeMs);

  // Summary
  printSummary(flatMarkets, ingestionTimeMs);

  console.log("=".repeat(60));
  log(`TOTAL: ${flatMarkets.length.toLocaleString()} markets ingested in ${(ingestionTimeMs / 1000).toFixed(1)}s`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("[INGEST] Fatal error:", err);
  process.exit(1);
});

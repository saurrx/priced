import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, "..", "data", "markets-snapshot.json");
const OUTPUT_PATH = join(__dirname, "..", "data", "market-analysis.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  closeTime: string;
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
  meta: any;
  events: Record<string, EventEntry>;
  markets: Record<string, FlatMarket>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[ANALYSIS] ${msg}`);
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "this", "that",
  "these", "those", "it", "its", "if", "then", "than", "as", "so",
  "not", "no", "nor", "up", "out", "off", "over", "under", "again",
  "further", "once", "here", "there", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other",
  "some", "such", "any", "only", "own", "same", "too", "very",
  "just", "about", "above", "after", "before", "between", "into",
  "through", "during", "he", "she", "they", "we", "you", "me",
  "him", "her", "us", "them", "my", "your", "his", "our", "their",
  "what", "which", "who", "whom", "whose",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$%'\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

// ---------------------------------------------------------------------------
// Part 1A: Event Title Patterns
// ---------------------------------------------------------------------------

interface PatternResult {
  pattern: string;
  count: number;
  pct: string;
  examples: string[];
}

function classifyEventTitlePattern(title: string): string {
  const t = title.trim();
  if (/^will\s/i.test(t)) return "Will [subject] [verb]?";
  if (/^who\s+will\s/i.test(t)) return "Who will [verb]?";
  if (/^what\s+will\s/i.test(t)) return "What will [metric] be?";
  if (/^when\s+will\s/i.test(t)) return "When will [event]?";
  if (/^how\s+(much|many|high|low|often)/i.test(t)) return "How [much/many]?";
  if (/\bvs\.?\b|\bat\b.*\bwinner\b|\bvs\b/i.test(t)) return "[Subject] vs [Subject]";
  if (/\bwinner\b|\bchampion\b|\bwin\b.*\?$/i.test(t)) return "[Subject] winner/champion?";
  if (/\babove\b|\bbelow\b|\bcross\b|\bhit\b|\bget\b.*\$|\bprice\b/i.test(t)) return "Price threshold";
  return "Other";
}

function analyzeEventTitlePatterns(events: Record<string, EventEntry>): PatternResult[] {
  const counts: Record<string, { count: number; examples: string[] }> = {};

  for (const event of Object.values(events)) {
    const pattern = classifyEventTitlePattern(event.title);
    if (!counts[pattern]) counts[pattern] = { count: 0, examples: [] };
    counts[pattern].count++;
    if (counts[pattern].examples.length < 3) counts[pattern].examples.push(event.title);
  }

  const total = Object.keys(events).length;
  return Object.entries(counts)
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([pattern, { count, examples }]) => ({
      pattern,
      count,
      pct: ((count / total) * 100).toFixed(1),
      examples,
    }));
}

// ---------------------------------------------------------------------------
// Part 1B: Market-Event Title Overlap
// ---------------------------------------------------------------------------

interface TitleOverlapResult {
  fullOverlap: number;
  addsEntity: number;
  addsThreshold: number;
  addsTimeBucket: number;
  other: number;
}

function analyzeMarketEventOverlap(
  events: Record<string, EventEntry>,
  markets: Record<string, FlatMarket>
): TitleOverlapResult {
  let fullOverlap = 0;
  let addsEntity = 0;
  let addsThreshold = 0;
  let addsTimeBucket = 0;
  let other = 0;

  for (const [, event] of Object.entries(events)) {
    for (const ticker of event.markets) {
      const m = markets[ticker];
      if (!m) continue;

      const eventTitle = event.title.toLowerCase();
      const marketTitle = m.title.toLowerCase();

      if (marketTitle.includes(eventTitle) || eventTitle.includes(marketTitle)) {
        fullOverlap++;
      } else if (m.yesSubTitle && m.yesSubTitle.length > 1) {
        // Market adds a specific entity via yesSubTitle
        addsEntity++;
      } else if (/\$[\d,.]+|[\d,.]+%/.test(m.title)) {
        addsThreshold++;
      } else if (/\bby\b.*\d{4}|\bby\b.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(m.title)) {
        addsTimeBucket++;
      } else {
        other++;
      }
    }
  }

  return { fullOverlap, addsEntity, addsThreshold, addsTimeBucket, other };
}

// ---------------------------------------------------------------------------
// Part 1C: Entity Extraction
// ---------------------------------------------------------------------------

interface Entity {
  entity: string;
  entityType: string;
  eventTickers: string[];
  marketTickers: string[];
}

function extractEntities(
  events: Record<string, EventEntry>,
  markets: Record<string, FlatMarket>
): Entity[] {
  // Use yesSubTitle as primary entity source — it's the most specific
  const entityMap = new Map<string, { type: string; events: Set<string>; markets: Set<string> }>();

  function addEntity(name: string, type: string, eventTicker: string, marketTicker: string) {
    const key = name.toLowerCase().trim();
    if (key.length < 2) return;
    if (!entityMap.has(key)) {
      entityMap.set(key, { type, events: new Set(), markets: new Set() });
    }
    const e = entityMap.get(key)!;
    e.events.add(eventTicker);
    e.markets.add(marketTicker);
  }

  // Price pattern
  const priceRegex = /\$[\d,]+(?:\.[\d]+)?(?:\s*[KkMmBb])?/g;
  // Crypto ticker pattern
  const cryptoRegex = /\b(BTC|ETH|SOL|XRP|DOGE|ADA|DOT|AVAX|MATIC|LINK|UNI|AAVE|BNB|SHIB|PEPE)\b/gi;
  // Date/event pattern
  const dateEventRegex = /\b(FOMC|Super Bowl|Oscars|State of the Union|Olympics|March Madness|World Cup|World Series|Stanley Cup|Grammys|Met Gala|CPI|GDP|NFP|IPO)\b/gi;

  for (const m of Object.values(markets)) {
    // yesSubTitle is often the specific entity
    if (m.yesSubTitle && m.yesSubTitle.length > 1 && m.yesSubTitle !== m.eventTitle) {
      // Determine type by category
      let type = "Other";
      const cat = m.category.toLowerCase();
      if (cat.includes("sport")) type = "Person/Team";
      else if (cat.includes("politic") || cat.includes("election")) type = "Person";
      else if (cat.includes("crypto")) type = "Crypto";
      else if (cat.includes("entertain")) type = "Person/Show";
      else if (cat.includes("compan")) type = "Company";
      else if (cat.includes("econom") || cat.includes("financial")) type = "Organization";
      else type = "Person"; // default
      addEntity(m.yesSubTitle, type, m.eventTicker, m.ticker);
    }

    // Extract prices
    const allText = `${m.title} ${m.eventTitle} ${m.rulesPrimary}`;
    for (const match of allText.matchAll(priceRegex)) {
      addEntity(match[0], "PriceLevel", m.eventTicker, m.ticker);
    }

    // Extract crypto tickers
    for (const match of allText.matchAll(cryptoRegex)) {
      addEntity(match[0].toUpperCase(), "CryptoTicker", m.eventTicker, m.ticker);
    }

    // Extract date/events
    for (const match of allText.matchAll(dateEventRegex)) {
      addEntity(match[0], "DateEvent", m.eventTicker, m.ticker);
    }
  }

  return [...entityMap.entries()]
    .map(([entity, info]) => ({
      entity: entity,
      entityType: info.type,
      eventTickers: [...info.events],
      marketTickers: [...info.markets],
    }))
    .sort((a, b) => b.marketTickers.length - a.marketTickers.length);
}

// ---------------------------------------------------------------------------
// Part 1D: Keyword Frequency
// ---------------------------------------------------------------------------

interface KeywordEntry {
  term: string;
  count: number;
  categories: Record<string, number>;
}

function analyzeKeywords(
  events: Record<string, EventEntry>,
  markets: Record<string, FlatMarket>
): KeywordEntry[] {
  const termCounts = new Map<string, { count: number; cats: Record<string, number> }>();

  for (const m of Object.values(markets)) {
    const text = `${m.title} ${m.eventTitle}`;
    const tokens = tokenize(text);
    const seen = new Set<string>();

    for (const t of tokens) {
      if (seen.has(t)) continue; // count each term once per market
      seen.add(t);
      if (!termCounts.has(t)) termCounts.set(t, { count: 0, cats: {} });
      const entry = termCounts.get(t)!;
      entry.count++;
      entry.cats[m.category] = (entry.cats[m.category] || 0) + 1;
    }
  }

  return [...termCounts.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 100)
    .map(([term, { count, cats }]) => ({ term, count, categories: cats }));
}

// ---------------------------------------------------------------------------
// Part 1E: Semantic Clustering
// ---------------------------------------------------------------------------

interface SemanticCluster {
  name: string;
  description: string;
  eventCount: number;
  eventTickers: string[];
}

function semanticCluster(events: Record<string, EventEntry>): SemanticCluster[] {
  const clusters: { name: string; description: string; test: (title: string, cat: string) => boolean; events: string[] }[] = [
    {
      name: "Price Thresholds",
      description: "Will [asset] be above/below $X?",
      test: (t) => /\babove\b|\bbelow\b|\bcross\b|\bhit\b|\$[\d]|price/i.test(t),
      events: [],
    },
    {
      name: "Election Outcomes",
      description: "Who will win [election]?",
      test: (t, c) => (c === "Elections" || /\belect\b|\bwin\b.*\b(president|governor|senator|mayor|congress)/i.test(t)),
      events: [],
    },
    {
      name: "Person Actions",
      description: "Will [person] do [thing]?",
      test: (t) => /^will\s+\w+\s+(resign|fire|pardon|nominate|announce|sign|veto|ban|invade|buy|sell|leave|step\s+down)/i.test(t),
      events: [],
    },
    {
      name: "Game Outcomes",
      description: "Who wins [game/match]?",
      test: (t, c) => c === "Sports" && /winner|champion|\bat\b.*\?|vs\.?/i.test(t),
      events: [],
    },
    {
      name: "Sports Season Awards",
      description: "Season/tournament winners and MVPs",
      test: (t, c) => c === "Sports" && /\bchampion\b|\bmvp\b|\baward\b|\btrophy\b|\btournament\b/i.test(t),
      events: [],
    },
    {
      name: "Nominations & Appointments",
      description: "Who will be nominated/appointed?",
      test: (t) => /\bnominate\b|\bappoint\b|\bconfirm\b|\bnominee\b/i.test(t),
      events: [],
    },
    {
      name: "Cultural Events",
      description: "Awards, shows, entertainment outcomes",
      test: (t, c) => c === "Entertainment" || /\boscar\b|\bgrammy\b|\bemmy\b|\bsurvivor\b|\bbachelor\b/i.test(t),
      events: [],
    },
    {
      name: "Crypto Markets",
      description: "Crypto price and event predictions",
      test: (t, c) => c === "Crypto" || /\bbitcoin\b|\bethereum\b|\bcrypto\b|\bbtc\b|\beth\b|\bsol\b/i.test(t),
      events: [],
    },
    {
      name: "Economic Indicators",
      description: "Fed, CPI, GDP, recession, rates",
      test: (t, c) => c === "Economics" || /\bfed\b|\bcpi\b|\bgdp\b|\brecession\b|\brate\s+cut\b|\binflation\b|\bunemployment\b/i.test(t),
      events: [],
    },
    {
      name: "Company Actions",
      description: "IPOs, acquisitions, CEO changes",
      test: (t, c) => c === "Companies" || /\bipo\b|\bacquire\b|\bmerge\b|\bceo\b|\bstock\b/i.test(t),
      events: [],
    },
    {
      name: "Geopolitics & World Events",
      description: "International relations, conflicts, treaties",
      test: (t) => /\binvade\b|\bwar\b|\btreaty\b|\bsanction\b|\bgreenland\b|\btaiwan\b|\biran\b|\bpanama\b|\bnato\b/i.test(t),
      events: [],
    },
    {
      name: "Science & Technology",
      description: "Space, AI, scientific breakthroughs",
      test: (t, c) => c === "Science and Technology" || /\bspacex\b|\bnasa\b|\bmars\b|\bai\b|\bAGI\b|\brobot\b/i.test(t),
      events: [],
    },
  ];

  const unclustered: string[] = [];

  for (const [ticker, event] of Object.entries(events)) {
    let matched = false;
    for (const cluster of clusters) {
      if (cluster.test(event.title, event.category)) {
        cluster.events.push(ticker);
        matched = true;
        break; // first match wins
      }
    }
    if (!matched) unclustered.push(ticker);
  }

  if (unclustered.length > 0) {
    clusters.push({
      name: "Uncategorized",
      description: "Events not matching any semantic cluster",
      test: () => false,
      events: unclustered,
    });
  }

  return clusters
    .filter((c) => c.events.length > 0)
    .map((c) => ({
      name: c.name,
      description: c.description,
      eventCount: c.events.length,
      eventTickers: c.events,
    }))
    .sort((a, b) => b.eventCount - a.eventCount);
}

// ---------------------------------------------------------------------------
// Part 2A: Spread Analysis
// ---------------------------------------------------------------------------

interface SpreadBucket {
  label: string;
  count: number;
  pct: string;
}

interface SpreadAnalysis {
  distribution: SpreadBucket[];
  byCategory: Record<string, { avgSpread: number; medianSpread: number; count: number }>;
  noAskCount: number;
  noBidCount: number;
}

function analyzeSpread(markets: FlatMarket[]): SpreadAnalysis {
  const spreads: { spread: number; category: string }[] = [];
  let noAskCount = 0;
  let noBidCount = 0;

  for (const m of markets) {
    if (m.yesAsk == null) { noAskCount++; continue; }
    if (m.yesBid == null) { noBidCount++; continue; }
    spreads.push({ spread: m.yesAsk - m.yesBid, category: m.category });
  }

  const buckets: [string, (s: number) => boolean][] = [
    ["0-2c (tight)", (s) => s <= 2],
    ["3-5c (acceptable)", (s) => s >= 3 && s <= 5],
    ["6-10c (wide)", (s) => s >= 6 && s <= 10],
    [">10c (very wide)", (s) => s > 10],
  ];

  const total = spreads.length;
  const distribution = buckets.map(([label, test]) => {
    const count = spreads.filter((s) => test(s.spread)).length;
    return { label, count, pct: ((count / total) * 100).toFixed(1) };
  });

  // By category
  const catSpreads: Record<string, number[]> = {};
  for (const s of spreads) {
    if (!catSpreads[s.category]) catSpreads[s.category] = [];
    catSpreads[s.category].push(s.spread);
  }

  const byCategory: Record<string, { avgSpread: number; medianSpread: number; count: number }> = {};
  for (const [cat, arr] of Object.entries(catSpreads)) {
    arr.sort((a, b) => a - b);
    byCategory[cat] = {
      avgSpread: Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10,
      medianSpread: arr[Math.floor(arr.length / 2)],
      count: arr.length,
    };
  }

  return { distribution, byCategory, noAskCount, noBidCount };
}

// ---------------------------------------------------------------------------
// Part 2B: Price Distribution
// ---------------------------------------------------------------------------

interface PriceBucket {
  label: string;
  range: string;
  count: number;
  pct: string;
}

function analyzePriceDistribution(markets: FlatMarket[]): PriceBucket[] {
  const buckets: [string, string, (p: number) => boolean][] = [
    ["Very unlikely", "0-10c", (p) => p >= 0 && p <= 10],
    ["Unlikely", "11-30c", (p) => p >= 11 && p <= 30],
    ["Uncertain (most interesting)", "31-70c", (p) => p >= 31 && p <= 70],
    ["Likely", "71-90c", (p) => p >= 71 && p <= 90],
    ["Near-certain", "91-100c", (p) => p >= 91 && p <= 100],
    ["No price", "N/A", () => false],
  ];

  const total = markets.length;
  const results: PriceBucket[] = [];

  for (const [label, range, test] of buckets) {
    if (label === "No price") {
      const count = markets.filter((m) => m.yesAsk == null && m.yesBid == null).length;
      results.push({ label, range, count, pct: ((count / total) * 100).toFixed(1) });
    } else {
      // Use the best available price indicator
      const count = markets.filter((m) => {
        const price = m.yesBid ?? m.yesAsk;
        if (price == null) return false;
        return test(price);
      }).length;
      results.push({ label, range, count, pct: ((count / total) * 100).toFixed(1) });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Part 2C: Volume vs Open Interest
// ---------------------------------------------------------------------------

interface VolumeOIAnalysis {
  avgTurnover: number;
  medianTurnover: number;
  highTurnover: number; // count with turnover > 10
  lowTurnover: number;  // count with turnover < 2
  zeroOI: number;
}

function analyzeVolumeOI(markets: FlatMarket[]): VolumeOIAnalysis {
  const turnovers: number[] = [];
  let zeroOI = 0;

  for (const m of markets) {
    if (m.openInterest === 0) {
      zeroOI++;
      continue;
    }
    turnovers.push(m.volume / m.openInterest);
  }

  turnovers.sort((a, b) => a - b);

  return {
    avgTurnover: Math.round((turnovers.reduce((s, v) => s + v, 0) / turnovers.length) * 10) / 10,
    medianTurnover: Math.round(turnovers[Math.floor(turnovers.length / 2)] * 10) / 10,
    highTurnover: turnovers.filter((t) => t > 10).length,
    lowTurnover: turnovers.filter((t) => t < 2).length,
    zeroOI,
  };
}

// ---------------------------------------------------------------------------
// Part 2D: Time-to-Close Analysis
// ---------------------------------------------------------------------------

interface TimeToCloseBucket {
  label: string;
  count: number;
  pct: string;
  avgVolumePerDay: number;
}

function analyzeTimeToClose(markets: FlatMarket[]): TimeToCloseBucket[] {
  const now = new Date("2026-02-21T00:00:00Z");
  const DAY_MS = 86400000;

  const buckets: { label: string; minDays: number; maxDays: number; markets: FlatMarket[] }[] = [
    { label: "Today/Tomorrow (0-1 days)", minDays: 0, maxDays: 1, markets: [] },
    { label: "This week (2-7 days)", minDays: 2, maxDays: 7, markets: [] },
    { label: "This month (8-30 days)", minDays: 8, maxDays: 30, markets: [] },
    { label: "1-3 months", minDays: 31, maxDays: 90, markets: [] },
    { label: "3-12 months", minDays: 91, maxDays: 365, markets: [] },
    { label: "1+ years", minDays: 366, maxDays: Infinity, markets: [] },
  ];

  for (const m of markets) {
    const daysToClose = Math.max(0, (new Date(m.closeTime).getTime() - now.getTime()) / DAY_MS);
    for (const b of buckets) {
      if (daysToClose >= b.minDays && daysToClose <= b.maxDays) {
        b.markets.push(m);
        break;
      }
    }
  }

  const total = markets.length;
  return buckets.map((b) => {
    const avgVolPerDay = b.markets.length > 0
      ? Math.round(
          b.markets.reduce((s, m) => {
            const age = Math.max(1, (now.getTime() - new Date(m.openTime).getTime()) / DAY_MS);
            return s + m.volume / age;
          }, 0) / b.markets.length
        )
      : 0;

    return {
      label: b.label,
      count: b.markets.length,
      pct: ((b.markets.length / total) * 100).toFixed(1),
      avgVolumePerDay: avgVolPerDay,
    };
  });
}

// ---------------------------------------------------------------------------
// Part 2E: Event Size Distribution
// ---------------------------------------------------------------------------

interface EventSizeBucket {
  label: string;
  count: number;
  pct: string;
  examples: string[];
}

function analyzeEventSizes(events: Record<string, EventEntry>): EventSizeBucket[] {
  const buckets: { label: string; min: number; max: number; events: { ticker: string; title: string; size: number }[] }[] = [
    { label: "Single market", min: 1, max: 1, events: [] },
    { label: "Small (2-5 markets)", min: 2, max: 5, events: [] },
    { label: "Medium (6-20 markets)", min: 6, max: 20, events: [] },
    { label: "Large (20+ markets)", min: 21, max: Infinity, events: [] },
  ];

  for (const [ticker, event] of Object.entries(events)) {
    const size = event.markets.length;
    for (const b of buckets) {
      if (size >= b.min && size <= b.max) {
        b.events.push({ ticker, title: event.title, size });
        break;
      }
    }
  }

  const total = Object.keys(events).length;
  return buckets.map((b) => {
    // Sort by size desc for examples
    b.events.sort((a, c) => c.size - a.size);
    return {
      label: b.label,
      count: b.events.length,
      pct: ((b.events.length / total) * 100).toFixed(1),
      examples: b.events.slice(0, 3).map((e) => `${e.title} (${e.size} markets)`),
    };
  });
}

// ---------------------------------------------------------------------------
// Part 3A: Matchability Score
// ---------------------------------------------------------------------------

interface MatchabilityEntry {
  eventTicker: string;
  title: string;
  category: string;
  score: number;
  reason: string;
}

function computeMatchability(
  events: Record<string, EventEntry>,
  markets: Record<string, FlatMarket>
): MatchabilityEntry[] {
  const results: MatchabilityEntry[] = [];

  for (const [ticker, event] of Object.entries(events)) {
    // Aggregate volume across child markets
    let totalVolume = 0;
    for (const mTicker of event.markets) {
      totalVolume += markets[mTicker]?.volume || 0;
    }

    let score = 1;
    let reason = "";

    // Volume-based scoring
    if (totalVolume > 10_000_000) { score = 5; reason = "Very high volume (>$10M)"; }
    else if (totalVolume > 1_000_000) { score = 4; reason = "High volume (>$1M)"; }
    else if (totalVolume > 500_000) { score = 3; reason = "Moderate volume (>$500K)"; }
    else if (totalVolume > 100_000) { score = 2; reason = "Low volume (>$100K)"; }
    else { score = 1; reason = "Very low volume"; }

    // Category boost
    const cat = event.category.toLowerCase();
    if (cat.includes("crypto") && score < 5) { score = Math.min(5, score + 1); reason += " + crypto boost"; }
    if (cat.includes("sport") && totalVolume > 200_000) { score = Math.min(5, score + 1); reason += " + sports boost"; }

    results.push({
      eventTicker: ticker,
      title: event.title,
      category: event.category,
      score,
      reason,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Part 3B: Collision Risk Map
// ---------------------------------------------------------------------------

interface CollisionCluster {
  name: string;
  eventTickers: string[];
  differentiator: string;
}

function findCollisions(
  events: Record<string, EventEntry>,
  markets: Record<string, FlatMarket>
): CollisionCluster[] {
  const clusters: CollisionCluster[] = [];

  // Group events by shared keywords
  const keywordGroups = new Map<string, string[]>();
  const importantKeywords = [
    "trump", "bitcoin", "btc", "ethereum", "eth", "fed", "nba", "nfl",
    "mlb", "nhl", "oscars", "epl", "spacex", "tesla", "openai",
    "recession", "inflation", "rate", "election", "president",
    "solana", "sol", "xrp", "doge", "ai",
  ];

  for (const [ticker, event] of Object.entries(events)) {
    const titleLower = event.title.toLowerCase();
    for (const kw of importantKeywords) {
      if (titleLower.includes(kw)) {
        if (!keywordGroups.has(kw)) keywordGroups.set(kw, []);
        keywordGroups.get(kw)!.push(ticker);
      }
    }
  }

  for (const [keyword, tickers] of keywordGroups) {
    if (tickers.length >= 2) {
      // Determine what differentiates these events
      let differentiator = "specific keywords or context";
      if (["bitcoin", "btc", "ethereum", "eth", "solana", "sol"].includes(keyword)) {
        differentiator = "price level ($X threshold), timeframe, or specific metric";
      } else if (["trump"].includes(keyword)) {
        differentiator = "action verb (nominate, resign, pardon, sign, buy) or target entity";
      } else if (["nba", "nfl", "mlb", "nhl", "epl"].includes(keyword)) {
        differentiator = "team names, game date, or season context";
      } else if (["fed", "rate", "recession", "inflation"].includes(keyword)) {
        differentiator = "specific meeting date, metric (CPI vs GDP), or threshold";
      } else if (["election", "president"].includes(keyword)) {
        differentiator = "year, office (president vs governor vs senate), or candidate name";
      }

      clusters.push({
        name: `${keyword} cluster (${tickers.length} events)`,
        eventTickers: tickers,
        differentiator,
      });
    }
  }

  return clusters.sort((a, b) => b.eventTickers.length - a.eventTickers.length);
}

// ---------------------------------------------------------------------------
// Part 3C: Entity Uniqueness
// ---------------------------------------------------------------------------

interface EntityUniqueness {
  uniqueEntities: number;
  ambiguousEntities: number;
  topAmbiguous: { entity: string; eventCount: number }[];
}

function checkEntityUniqueness(entities: Entity[]): EntityUniqueness {
  let unique = 0;
  let ambiguous = 0;
  const ambiguousList: { entity: string; eventCount: number }[] = [];

  for (const e of entities) {
    if (e.eventTickers.length === 1) {
      unique++;
    } else {
      ambiguous++;
      ambiguousList.push({ entity: e.entity, eventCount: e.eventTickers.length });
    }
  }

  ambiguousList.sort((a, b) => b.eventCount - a.eventCount);

  return {
    uniqueEntities: unique,
    ambiguousEntities: ambiguous,
    topAmbiguous: ambiguousList.slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// Part 3D: Recommended Matching Strategy
// ---------------------------------------------------------------------------

interface CategoryStrategy {
  category: string;
  marketCount: number;
  primaryStrategy: string;
  supplementary: string;
}

function recommendStrategies(markets: FlatMarket[]): CategoryStrategy[] {
  const catCounts: Record<string, number> = {};
  for (const m of markets) {
    catCounts[m.category] = (catCounts[m.category] || 0) + 1;
  }

  const strategies: Record<string, { primary: string; supplementary: string }> = {
    Sports: { primary: "Entity (team/player name)", supplementary: "Game date + matchup extraction" },
    Politics: { primary: "Entity (person name) + action keyword", supplementary: "Embedding for policy tweets" },
    Crypto: { primary: "Ticker (BTC/ETH/SOL) + price level extraction", supplementary: "Sentiment embedding for general crypto tweets" },
    Economics: { primary: "Keyword (Fed, CPI, recession, rate)", supplementary: "Date extraction for meeting-specific" },
    Entertainment: { primary: "Entity (show/movie/artist name)", supplementary: "Embedding for general entertainment" },
    Elections: { primary: "Entity (candidate name) + office + year", supplementary: "Location extraction for state races" },
    Companies: { primary: "Entity (company name) + action keyword", supplementary: "Ticker symbol matching" },
    "Science and Technology": { primary: "Entity (org/product name)", supplementary: "Topic embedding" },
    "Climate and Weather": { primary: "Location + weather keyword", supplementary: "Temperature/metric extraction" },
    Financials: { primary: "Ticker + metric keyword", supplementary: "Threshold extraction" },
    Mentions: { primary: "Entity (person name) + platform keyword", supplementary: "Embedding" },
    Health: { primary: "Keyword (outbreak, vaccine, WHO)", supplementary: "Embedding" },
    Social: { primary: "Entity + keyword", supplementary: "Embedding" },
    World: { primary: "Location + geopolitical keyword", supplementary: "Entity extraction" },
    Unknown: { primary: "Full-text embedding", supplementary: "Keyword fallback" },
  };

  return Object.entries(catCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, count]) => ({
      category: cat,
      marketCount: count,
      primaryStrategy: strategies[cat]?.primary || "Full-text embedding",
      supplementary: strategies[cat]?.supplementary || "Keyword fallback",
    }));
}

// ---------------------------------------------------------------------------
// Report Printer
// ---------------------------------------------------------------------------

function printReport(analysis: any) {
  const sep = "=".repeat(70);
  const subsep = "-".repeat(70);
  const p = console.log;

  p("");
  p(sep);
  p("  MARKET ANALYSIS REPORT");
  p(sep);

  // Part 1A
  p("");
  p("  PART 1A: EVENT TITLE PATTERNS");
  p(subsep);
  for (const r of analysis.eventTitlePatterns) {
    p(`  ${r.pattern.padEnd(35)} ${String(r.count).padStart(5)}  (${r.pct.padStart(5)}%)`);
    for (const ex of r.examples) {
      p(`    -> "${ex}"`);
    }
  }

  // Part 1B
  p("");
  p("  PART 1B: MARKET-EVENT TITLE OVERLAP");
  p(subsep);
  const overlap = analysis.titleOverlap;
  p(`  Full overlap (market ⊆ event):   ${overlap.fullOverlap}`);
  p(`  Adds specific entity:            ${overlap.addsEntity}`);
  p(`  Adds price threshold:            ${overlap.addsThreshold}`);
  p(`  Adds time bucket:                ${overlap.addsTimeBucket}`);
  p(`  Other:                           ${overlap.other}`);

  // Part 1C
  p("");
  p("  PART 1C: ENTITY EXTRACTION");
  p(subsep);
  const entities = analysis.entities;
  p(`  Total entities extracted: ${entities.length}`);
  const typeCounts: Record<string, number> = {};
  for (const e of entities) {
    typeCounts[e.entityType] = (typeCounts[e.entityType] || 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCounts).sort(([, a], [, b]) => b - a)) {
    p(`    ${type.padEnd(20)} ${String(count).padStart(5)}`);
  }
  p("");
  p("  Top 15 entities by market coverage:");
  for (const e of entities.slice(0, 15)) {
    p(`    ${e.entity.padEnd(25)} ${String(e.marketTickers.length).padStart(3)} markets  ${String(e.eventTickers.length).padStart(2)} events  [${e.entityType}]`);
  }

  // Part 1D
  p("");
  p("  PART 1D: KEYWORD FREQUENCY (top 30)");
  p(subsep);
  for (const k of analysis.keywords.slice(0, 30)) {
    const topCat = Object.entries(k.categories).sort(([, a]: any, [, b]: any) => b - a)[0];
    p(`  ${k.term.padEnd(20)} ${String(k.count).padStart(5)} markets  (top cat: ${topCat[0]})`);
  }

  // Part 1E
  p("");
  p("  PART 1E: SEMANTIC CLUSTERS");
  p(subsep);
  for (const c of analysis.semanticClusters) {
    p(`  ${c.name.padEnd(30)} ${String(c.eventCount).padStart(5)} events  "${c.description}"`);
  }

  // Part 2A
  p("");
  p("  PART 2A: SPREAD ANALYSIS");
  p(subsep);
  const spread = analysis.spreadAnalysis;
  for (const b of spread.distribution) {
    p(`  ${b.label.padEnd(25)} ${String(b.count).padStart(5)}  (${b.pct.padStart(5)}%)`);
  }
  p(`  No ask price:              ${spread.noAskCount}`);
  p(`  No bid price:              ${spread.noBidCount}`);
  p("");
  p("  By category (avg spread in cents):");
  for (const [cat, info] of Object.entries(spread.byCategory).sort(([, a]: any, [, b]: any) => a.avgSpread - b.avgSpread) as any) {
    p(`    ${cat.padEnd(25)} avg=${String(info.avgSpread).padStart(4)}c  median=${String(info.medianSpread).padStart(3)}c  (${info.count} markets)`);
  }

  // Part 2B
  p("");
  p("  PART 2B: PRICE DISTRIBUTION (by yesBid)");
  p(subsep);
  for (const b of analysis.priceDistribution) {
    p(`  ${b.label.padEnd(35)} ${String(b.count).padStart(5)}  (${b.pct.padStart(5)}%)`);
  }

  // Part 2C
  p("");
  p("  PART 2C: VOLUME vs OPEN INTEREST");
  p(subsep);
  const voi = analysis.volumeOI;
  p(`  Avg turnover (vol/OI):     ${voi.avgTurnover}`);
  p(`  Median turnover:           ${voi.medianTurnover}`);
  p(`  High turnover (>10x):      ${voi.highTurnover}`);
  p(`  Low turnover (<2x):        ${voi.lowTurnover}`);
  p(`  Zero open interest:        ${voi.zeroOI}`);

  // Part 2D
  p("");
  p("  PART 2D: TIME-TO-CLOSE");
  p(subsep);
  for (const b of analysis.timeToClose) {
    p(`  ${b.label.padEnd(30)} ${String(b.count).padStart(5)}  (${b.pct.padStart(5)}%)  avg vol/day: $${b.avgVolumePerDay.toLocaleString()}`);
  }

  // Part 2E
  p("");
  p("  PART 2E: EVENT SIZE DISTRIBUTION");
  p(subsep);
  for (const b of analysis.eventSizes) {
    p(`  ${b.label.padEnd(25)} ${String(b.count).padStart(5)}  (${b.pct.padStart(5)}%)`);
    for (const ex of b.examples) {
      p(`    -> ${ex}`);
    }
  }

  // Part 3A
  p("");
  p("  PART 3A: MATCHABILITY SCORES");
  p(subsep);
  const scores = [5, 4, 3, 2, 1];
  for (const s of scores) {
    const count = analysis.matchability.filter((m: any) => m.score === s).length;
    p(`  Score ${s}: ${String(count).padStart(5)} events`);
  }
  p("");
  p("  Top 10 most matchable events:");
  for (const m of analysis.matchability.slice(0, 10)) {
    p(`    [${m.score}] ${m.title.padEnd(50)} (${m.category})`);
  }

  // Part 3B
  p("");
  p("  PART 3B: COLLISION RISK MAP");
  p(subsep);
  for (const c of analysis.collisions.slice(0, 15)) {
    p(`  ${c.name}`);
    p(`    Differentiator: ${c.differentiator}`);
  }

  // Part 3C
  p("");
  p("  PART 3C: ENTITY UNIQUENESS");
  p(subsep);
  const eu = analysis.entityUniqueness;
  p(`  Unique identifiers:   ${eu.uniqueEntities} (map to exactly 1 event)`);
  p(`  Ambiguous entities:   ${eu.ambiguousEntities} (map to 2+ events, need context)`);
  p("");
  p("  Top ambiguous entities:");
  for (const e of eu.topAmbiguous.slice(0, 10)) {
    p(`    "${e.entity}" -> ${e.eventCount} events`);
  }

  // Part 3D
  p("");
  p("  PART 3D: RECOMMENDED MATCHING STRATEGY PER CATEGORY");
  p(subsep);
  for (const s of analysis.categoryStrategies) {
    p(`  ${s.category} (${s.marketCount} markets)`);
    p(`    Primary:       ${s.primaryStrategy}`);
    p(`    Supplementary: ${s.supplementary}`);
  }

  p("");
  p(sep);
  p("  ANALYSIS COMPLETE");
  p(sep);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  log("Loading snapshot...");
  const raw = readFileSync(SNAPSHOT_PATH, "utf-8");
  const snapshot: Snapshot = JSON.parse(raw);
  const markets = Object.values(snapshot.markets);
  const events = snapshot.events;
  log(`Loaded: ${markets.length.toLocaleString()} markets, ${Object.keys(events).length.toLocaleString()} events`);

  log("Part 1: Title & text patterns...");

  log("  1A: Event title patterns...");
  const eventTitlePatterns = analyzeEventTitlePatterns(events);
  log(`  1A: Event title patterns classified (${Object.keys(events).length} events)`);

  log("  1B: Market-event title overlap...");
  const titleOverlap = analyzeMarketEventOverlap(events, snapshot.markets);
  log("  1B: Market-event title overlap computed");

  log("  1C: Entity extraction...");
  const entities = extractEntities(events, snapshot.markets);
  log(`  1C: ${entities.length.toLocaleString()} entities extracted`);

  log("  1D: Keyword frequency...");
  const keywords = analyzeKeywords(events, snapshot.markets);
  log("  1D: Top 100 keywords identified");

  log("  1E: Semantic clustering...");
  const semanticClusters = semanticCluster(events);
  log(`  1E: ${semanticClusters.length} semantic clusters found`);

  log("Part 2: Market quality...");

  log("  2A: Spread analysis...");
  const spreadAnalysis = analyzeSpread(markets);
  log("  2A: Spread distribution computed");

  log("  2B: Price distribution...");
  const priceDistribution = analyzePriceDistribution(markets);
  log("  2B: Price distribution computed");

  log("  2C: Volume/OI analysis...");
  const volumeOI = analyzeVolumeOI(markets);
  log("  2C: Volume/OI analysis complete");

  log("  2D: Time-to-close...");
  const timeToClose = analyzeTimeToClose(markets);
  log("  2D: Time-to-close buckets computed");

  log("  2E: Event sizes...");
  const eventSizes = analyzeEventSizes(events);
  log("  2E: Event size distribution computed");

  log("Part 3: Matching readiness...");

  log("  3A: Matchability scores...");
  const matchability = computeMatchability(events, snapshot.markets);
  log("  3A: Matchability scores assigned");

  log("  3B: Collision risk...");
  const collisions = findCollisions(events, snapshot.markets);
  log(`  3B: ${collisions.length} collision clusters identified`);

  log("  3C: Entity uniqueness...");
  const entityUniqueness = checkEntityUniqueness(entities);
  log(`  3C: Entity uniqueness: ${entityUniqueness.uniqueEntities} unique, ${entityUniqueness.ambiguousEntities} ambiguous`);

  log("  3D: Category strategies...");
  const categoryStrategies = recommendStrategies(markets);
  log("  3D: Per-category strategies recommended");

  // Build output
  const analysis = {
    eventTitlePatterns,
    titleOverlap,
    entities,
    keywords,
    semanticClusters,
    spreadAnalysis,
    priceDistribution,
    volumeOI,
    timeToClose,
    eventSizes,
    matchability,
    collisions,
    entityUniqueness,
    categoryStrategies,
  };

  // Save JSON
  writeFileSync(OUTPUT_PATH, JSON.stringify(analysis, null, 2));
  log(`Output: data/market-analysis.json`);

  // Print report
  printReport(analysis);
}

main();

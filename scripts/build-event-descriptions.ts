import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, "..", "data", "markets-snapshot.json");
const OUTPUT_PATH = join(__dirname, "..", "data", "event-descriptions.json");

function log(msg: string) { console.log(`[DESCRIPTIONS] ${msg}`); }

// ---------------------------------------------------------------------------
// Category keyword banks (how people tweet about each category)
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Sports: ["game", "match", "win", "winner", "champion", "championship", "playoff", "finals", "season", "league", "score", "playing", "team"],
  Politics: ["president", "congress", "senate", "vote", "policy", "resign", "impeach", "pardon", "sign", "executive order", "administration"],
  Entertainment: ["movie", "film", "show", "awards", "best picture", "best actor", "best actress", "best director", "nominee", "winner", "album", "song", "streaming"],
  Crypto: ["crypto", "pump", "dump", "bull", "bear", "moon", "ath", "all-time high", "price", "rally", "crash", "market cap", "defi", "blockchain"],
  Economics: ["fed", "federal reserve", "interest rate", "rate cut", "rate hike", "inflation", "cpi", "gdp", "recession", "jobs", "unemployment", "nonfarm", "economic"],
  Elections: ["election", "vote", "primary", "nominee", "candidate", "ballot", "swing state", "polls", "polling", "running for", "campaign"],
  Companies: ["ipo", "stock", "earnings", "acquisition", "ceo", "shares", "valuation", "market cap", "revenue", "quarterly"],
  "Science and Technology": ["launch", "space", "ai", "artificial intelligence", "research", "breakthrough", "discovery", "technology", "innovation"],
  Financials: ["stock market", "s&p", "nasdaq", "dow", "index", "trading", "bull market", "bear market", "correction"],
  "Climate and Weather": ["temperature", "weather", "climate", "hurricane", "storm", "heat", "cold", "record"],
  Health: ["outbreak", "vaccine", "virus", "pandemic", "who", "health", "disease"],
  Mentions: ["mention", "tweet", "post", "social media", "said", "commented"],
};

// Sport-specific keywords
const SPORT_KEYWORDS: Record<string, string[]> = {
  basketball: ["nba", "basketball", "court", "dunk", "three-pointer", "rebound"],
  football: ["nfl", "football", "touchdown", "super bowl", "quarterback"],
  golf: ["pga", "golf", "birdie", "eagle", "bogey", "par", "round", "course", "major", "masters", "open"],
  soccer: ["epl", "premier league", "soccer", "football", "goal", "match", "champions league", "world cup"],
  hockey: ["nhl", "hockey", "goal", "assist", "stanley cup", "ice"],
  baseball: ["mlb", "baseball", "home run", "pitcher", "world series"],
  mma: ["ufc", "mma", "fight", "knockout", "submission", "round"],
  tennis: ["atp", "wta", "tennis", "grand slam", "wimbledon", "us open", "australian open", "french open"],
};

// ---------------------------------------------------------------------------
// Build enriched descriptions
// ---------------------------------------------------------------------------

log("Loading snapshot...");
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
const events = snapshot.events as Record<string, any>;
const markets = snapshot.markets as Record<string, any>;

log(`Loaded: ${Object.keys(events).length} events, ${Object.keys(markets).length} markets`);
log("Building enriched descriptions...");

interface EventDescription {
  eventTicker: string;
  rawTitle: string;
  enrichedDescription: string;
  category: string;
  marketTickers: string[];
  topEntities: string[];
}

const descriptions: EventDescription[] = [];

for (const [eventTicker, event] of Object.entries(events) as [string, any][]) {
  const parts: string[] = [];

  // 1. Raw event title
  parts.push(event.title);

  // 2. Event subtitle if present
  if (event.subtitle) {
    parts.push(event.subtitle);
  }

  // 3. Collect yesSubTitle values from child markets (specific entities)
  const childMarkets = event.markets
    .map((t: string) => markets[t])
    .filter(Boolean);

  const subTitles = new Set<string>();
  for (const m of childMarkets) {
    if (m.yesSubTitle && m.yesSubTitle.length > 1) {
      subTitles.add(m.yesSubTitle);
    }
  }

  // Only include top entities (by volume) to keep description concise
  const sortedByVolume = childMarkets
    .filter((m: any) => m.yesSubTitle && m.yesSubTitle.length > 1)
    .sort((a: any, b: any) => b.volume - a.volume);

  const topEntities = sortedByVolume
    .slice(0, 8)
    .map((m: any) => m.yesSubTitle)
    .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i); // dedupe

  if (topEntities.length > 0) {
    parts.push(topEntities.join(", "));
  }

  // 4. Category-specific keywords
  const catKeywords = CATEGORY_KEYWORDS[event.category] || [];
  // Pick 3-5 relevant keywords based on title content
  const titleLower = event.title.toLowerCase();
  const relevantKeywords = catKeywords.filter((kw) => {
    // Include keywords that are contextually relevant but not already in the title
    return !titleLower.includes(kw.toLowerCase());
  }).slice(0, 4);

  if (relevantKeywords.length > 0) {
    parts.push(relevantKeywords.join(", "));
  }

  // 5. Sport-specific enrichment
  if (event.category === "Sports") {
    for (const [sport, keywords] of Object.entries(SPORT_KEYWORDS)) {
      const titleAndSubs = `${titleLower} ${topEntities.join(" ").toLowerCase()}`;
      if (keywords.some((kw) => titleAndSubs.includes(kw))) {
        const extraKw = keywords.filter((kw) => !titleAndSubs.includes(kw)).slice(0, 2);
        if (extraKw.length > 0) parts.push(extraKw.join(", "));
        break;
      }
    }
  }

  // 6. Informal phrasing (how people tweet)
  if (/who will/i.test(event.title)) {
    parts.push("prediction guess pick favorite frontrunner");
  } else if (/will.*\?/i.test(event.title)) {
    parts.push("going to happen likely chance odds");
  } else if (/winner|champion/i.test(event.title)) {
    parts.push("winning taking it all going all the way favorites");
  } else if (/price|above|below|cross|hit/i.test(event.title)) {
    parts.push("price target breaking reaching level support resistance");
  } else if (/how (high|low|much|many)/i.test(event.title)) {
    parts.push("prediction forecast expectations reaching level");
  }

  // 7. Add crypto-specific terms
  if (event.category === "Crypto" || /bitcoin|ethereum|btc|eth|sol|crypto/i.test(titleLower)) {
    const cryptoTerms = ["crypto", "cryptocurrency", "token", "coin"];
    const missing = cryptoTerms.filter((t) => !titleLower.includes(t));
    if (missing.length > 0) parts.push(missing.slice(0, 2).join(", "));
  }

  // Build final description
  let description = parts.join(". ").replace(/\.\./g, ".").replace(/\s+/g, " ").trim();

  // Enforce 150-word limit
  const words = description.split(/\s+/);
  if (words.length > 140) {
    description = words.slice(0, 140).join(" ");
  }

  descriptions.push({
    eventTicker,
    rawTitle: event.title,
    enrichedDescription: description,
    category: event.category,
    marketTickers: event.markets,
    topEntities: topEntities.map((e: string) => e.toLowerCase()),
  });
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

log("Validating...");
let issues = 0;

if (descriptions.length !== Object.keys(events).length) {
  log(`  ERROR: ${descriptions.length} descriptions but ${Object.keys(events).length} events`);
  issues++;
}

for (const d of descriptions) {
  if (!d.enrichedDescription || d.enrichedDescription.trim().length === 0) {
    log(`  ERROR: Empty description for ${d.eventTicker}`);
    issues++;
  }
  const wordCount = d.enrichedDescription.split(/\s+/).length;
  if (wordCount > 150) {
    log(`  WARN: ${d.eventTicker} has ${wordCount} words (limit 150)`);
    issues++;
  }
  if (!events[d.eventTicker]) {
    log(`  ERROR: ${d.eventTicker} not in snapshot`);
    issues++;
  }
}

const maxWords = Math.max(...descriptions.map((d) => d.enrichedDescription.split(/\s+/).length));
const avgWords = Math.round(descriptions.reduce((s, d) => s + d.enrichedDescription.split(/\s+/).length, 0) / descriptions.length);

if (issues === 0) {
  log("  All validation checks passed");
} else {
  log(`  ${issues} issues found`);
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

log("Writing event-descriptions.json...");

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  stats: {
    totalEvents: descriptions.length,
    avgWords,
    maxWords,
  },
  events: descriptions,
};

writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / (1024 * 1024)).toFixed(1);
log(`Output: data/event-descriptions.json (${sizeMB} MB)`);
log(`  Events: ${descriptions.length} | Avg words: ${avgWords} | Max words: ${maxWords}`);

// Print a few samples
log("");
log("Sample descriptions:");
for (const d of descriptions.slice(0, 5)) {
  log(`  [${d.category}] ${d.rawTitle}`);
  log(`    -> ${d.enrichedDescription.slice(0, 200)}...`);
  log(`    Entities: ${d.topEntities.slice(0, 5).join(", ")}`);
  log("");
}

log("Done.");

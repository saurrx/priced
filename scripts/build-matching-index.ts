import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, "..", "data", "markets-snapshot.json");
const ANALYSIS_PATH = join(__dirname, "..", "data", "market-analysis.json");
const OUTPUT_PATH = join(__dirname, "..", "data", "matching-index.json");

function log(msg: string) { console.log(`[INDEX] ${msg}`); }
function warn(msg: string) { console.warn(`[INDEX] WARN: ${msg}`); }

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

log("Loading data files...");
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
const analysis = JSON.parse(readFileSync(ANALYSIS_PATH, "utf-8"));

const markets: Record<string, any> = snapshot.markets;
const events: Record<string, any> = snapshot.events;
const entities: any[] = analysis.entities;
const collisions: any[] = analysis.collisions;

log(`Loaded: ${Object.keys(markets).length} markets, ${Object.keys(events).length} events, ${entities.length} entities`);

// ---------------------------------------------------------------------------
// Step 1: Build unique + ambiguous entity maps
// ---------------------------------------------------------------------------

log("Step 1: Building entity maps...");

interface UniqueEntry {
  eventTicker: string;
  marketTickers: string[];
  entityType: string;
}

const unique: Record<string, UniqueEntry> = {};
const ambiguous: Record<string, string[]> = {};

// Filter out low-quality entities
const SKIP_ENTITIES = new Set([
  "yes", "no", "tie", "draw", "other", "field", "none",
  "before 2027", "before jan 1, 2027", "before 2028",
  "before jan 1, 2028", "before 2029", "before jan 1, 2029",
  "before 2030", "before jan 1, 2030", "before jan 20, 2029",
  "united states", "u.s.", "usa",
]);

// Common English words that cause false positive matches
const COMMON_WORDS = new Set([
  "win", "won", "run", "go", "get", "set", "cut", "hit", "put", "let",
  "end", "top", "low", "new", "old", "big", "hot", "red", "blue", "day",
  "man", "men", "back", "over", "under", "more", "less", "best", "first",
  "last", "next", "game", "team", "play", "time", "year", "week",
  "skate", "competition", "acquisition", "mobile", "underperformance",
  "world", "rights", "million", "money", "price", "market", "trade",
  "crash", "deal", "crimes", "hottest",
]);

// Date-range entities are too generic ("before 2026", "before march", etc.)
function isDateRangeEntity(key: string): boolean {
  return key.startsWith("before ") || key.startsWith("after ") ||
    key.startsWith("in 20") || key.startsWith("none before");
}

for (const entity of entities) {
  const key = entity.entity.toLowerCase().trim();

  // Skip noise entities
  if (SKIP_ENTITIES.has(key)) continue;
  if (key.length < 3) continue; // Minimum 3 chars to avoid false substring matches
  if (COMMON_WORDS.has(key)) continue;
  if (isDateRangeEntity(key)) continue;

  // Skip pure price levels for entity index (they'll be in bigrams)
  if (entity.entityType === "PriceLevel") continue;

  // Skip generic DateEvent entries that are too common
  if (entity.entityType === "DateEvent" && entity.eventTickers.length > 10) continue;

  if (entity.eventTickers.length === 1) {
    unique[key] = {
      eventTicker: entity.eventTickers[0],
      marketTickers: entity.marketTickers,
      entityType: entity.entityType,
    };
  } else {
    ambiguous[key] = entity.eventTickers;
  }
}

// Force certain entities to be ambiguous by scanning event titles
// These are terms that logically relate to many events but may only appear as
// a yesSubTitle in one event during entity extraction
const FORCE_AMBIGUOUS_SCAN = ["trump", "biden", "bitcoin", "ethereum", "fed"];
for (const term of FORCE_AMBIGUOUS_SCAN) {
  const relatedEvents: string[] = [];
  for (const [ticker, event] of Object.entries(events) as [string, any][]) {
    if (event.title.toLowerCase().includes(term)) {
      relatedEvents.push(ticker);
    }
  }
  if (relatedEvents.length > 1) {
    // Move from unique to ambiguous if it was unique
    if (unique[term]) delete unique[term];
    ambiguous[term] = relatedEvents;
    log(`  Forced "${term}" to ambiguous (${relatedEvents.length} events)`);
  }
}

// Step 1b: Add event-title keyword entities
// These are common terms people use that map to events via title/ticker patterns
log("Step 1b: Adding title-keyword entities...");

const TITLE_KEYWORD_MAP: Record<string, RegExp> = {
  // Sports
  "nba": /^KXNBA/,
  "lakers": /NBA.*LAL|NBAGAME.*LAL/,
  "celtics": /NBA.*BOS|NBAGAME.*BOS/,
  "bucks": /NBA.*MIL|NBAGAME.*MIL/,
  "warriors": /NBA.*GSW|NBAGAME.*GSW/,
  "nuggets": /NBA.*DEN|NBAGAME.*DEN/,
  "march madness": /MARMAD/,
  "ncaa": /MARMAD|NCAA|COLLEGE/,
  "ufc": /UFC/,
  "premier league": /EPL/,
  "epl": /EPL/,
  "champions league": /CHAMPIONSLEAGUE|UCL/,
  "super bowl": /SUPERBOWL|NFLSB/,
  "nfl": /^KXNFL/,
  "world cup": /WORLDCUP|FIFAWC|WO-GOLD|WO-MEDAL/,
  // Entertainment
  "oscars": /OSCAR/,
  "oscar": /OSCAR/,
  "best picture": /OSCARPIC/,
  "best actor": /OSCARACTO/,
  "survivor": /SURVIVOR/,
  "beast games": /BEAST/,
  "gta": /GTA/,
  // Economics
  "recession": /RECSSN/,
  "gdp": /GDP|DEBT.*GDP/,
  "cpi": /CPI/,
  "inflation": /CPI|INFLAT/,
  "interest rate": /FEDDECISION|FEDRATE/,
  // Sci/Tech
  "ipo": /IPO/,
  "spacex": /IPO|SPACEX/,
  "openai": /IPO|OPENAI/,
  "starship": /SPACEX|STARSHIP/,
};

for (const [keyword, pattern] of Object.entries(TITLE_KEYWORD_MAP)) {
  if (unique[keyword] || ambiguous[keyword]) continue; // don't overwrite
  const matchingEvents = Object.keys(events).filter(t => pattern.test(t));
  if (matchingEvents.length === 0) continue;
  if (matchingEvents.length === 1) {
    const eventTicker = matchingEvents[0];
    const eventMarkets = (events[eventTicker] as any).markets || [];
    unique[keyword] = {
      eventTicker,
      marketTickers: eventMarkets,
      entityType: "TitleKeyword",
    };
  } else {
    ambiguous[keyword] = matchingEvents;
  }
  log(`  Added "${keyword}" → ${matchingEvents.length === 1 ? 'unique' : 'ambiguous'}(${matchingEvents.length} events)`);
}

log(`  Unique entities: ${Object.keys(unique).length}`);
log(`  Ambiguous entities: ${Object.keys(ambiguous).length}`);

// ---------------------------------------------------------------------------
// Step 2: Build bigrams from collision clusters + market data
// ---------------------------------------------------------------------------

log("Step 2: Building bigrams...");

const bigrams: Record<string, string> = {};

// Strategy: For each ambiguous entity, look at the event titles to find
// discriminating keywords that form bigrams
for (const [entity, eventTickers] of Object.entries(ambiguous)) {
  for (const eventTicker of eventTickers) {
    const event = events[eventTicker];
    if (!event) continue;

    const titleLower = event.title.toLowerCase();
    const tokens = titleLower
      .replace(/[^a-z0-9$\s]/g, " ")
      .split(/\s+/)
      .filter((t: string) => t.length > 1);

    // Find keywords in the title that aren't the entity itself
    for (const token of tokens) {
      if (token === entity) continue;
      if (["will", "the", "who", "what", "how", "when", "and", "for", "has", "have", "been", "this", "that", "with", "from", "are", "was", "were", "be"].includes(token)) continue;

      const bigram = `${entity} ${token}`;
      if (!bigrams[bigram]) {
        bigrams[bigram] = eventTicker;
      }
    }
  }
}

// Add manually curated high-value bigrams
const manualBigrams: Record<string, string> = {};

// Find event tickers for specific bigrams from the data
function findEventByTitle(pattern: RegExp): string | null {
  for (const [ticker, event] of Object.entries(events) as [string, any][]) {
    if (pattern.test(event.title.toLowerCase())) return ticker;
  }
  return null;
}

// Trump bigrams
const trumpGreenland = findEventByTitle(/trump.*greenland|greenland.*trump/);
const trumpResign = findEventByTitle(/trump.*resign|trump.*out.*president/);
const fedChair = findEventByTitle(/fed.*chair.*nomin|nomin.*fed.*chair/);
const fedDecision = findEventByTitle(/fed.*decision.*mar|fed.*mar.*2026/);
const btc150 = findEventByTitle(/bitcoin.*150/);
const btc200 = findEventByTitle(/bitcoin.*200/);
const btc100 = findEventByTitle(/bitcoin.*100/);

if (trumpGreenland) { manualBigrams["trump greenland"] = trumpGreenland; manualBigrams["greenland buy"] = trumpGreenland; }
if (trumpResign) { manualBigrams["trump resign"] = trumpResign; manualBigrams["trump impeach"] = trumpResign; }
if (fedChair) { manualBigrams["fed chair"] = fedChair; manualBigrams["fed nominee"] = fedChair; manualBigrams["fed nomination"] = fedChair; }
if (fedDecision) { manualBigrams["fed cut"] = fedDecision; manualBigrams["rate cut"] = fedDecision; manualBigrams["rate hold"] = fedDecision; manualBigrams["fed rate"] = fedDecision; }
if (btc150) { manualBigrams["bitcoin 150"] = btc150; manualBigrams["btc 150"] = btc150; }
if (btc200) { manualBigrams["bitcoin 200"] = btc200; manualBigrams["btc 200"] = btc200; }
if (btc100) { manualBigrams["bitcoin 100"] = btc100; manualBigrams["btc 100"] = btc100; }

// Merge manual bigrams (override auto-generated)
for (const [bg, ticker] of Object.entries(manualBigrams)) {
  bigrams[bg] = ticker;
}

// Validate bigrams — remove any that point to non-existent events
const validBigrams: Record<string, string> = {};
for (const [bg, ticker] of Object.entries(bigrams)) {
  if (events[ticker]) {
    validBigrams[bg] = ticker;
  }
}

log(`  Bigrams: ${Object.keys(validBigrams).length}`);

// ---------------------------------------------------------------------------
// Step 3: Build aliases programmatically
// ---------------------------------------------------------------------------

log("Step 3: Building aliases...");

const aliases: Record<string, string> = {};

// --- Crypto tickers ---
const cryptoMap: Record<string, string> = {
  btc: "bitcoin", "$btc": "bitcoin", "\u20bfbtc": "bitcoin",
  eth: "ethereum", "$eth": "ethereum",
  sol: "solana", "$sol": "solana",
  xrp: "xrp", "$xrp": "xrp",
  doge: "dogecoin", "$doge": "dogecoin",
  ada: "cardano", "$ada": "cardano",
  dot: "polkadot", "$dot": "polkadot",
  avax: "avalanche", "$avax": "avalanche",
  matic: "polygon", "$matic": "polygon",
  link: "chainlink", "$link": "chainlink",
  uni: "uniswap", "$uni": "uniswap",
  aave: "aave", "$aave": "aave",
  bnb: "bnb", "$bnb": "bnb",
  shib: "shib", "$shib": "shib",
  pepe: "pepe", "$pepe": "pepe",
};

for (const [alias, canonical] of Object.entries(cryptoMap)) {
  // Only add if canonical exists in our entity index
  if (unique[canonical] || ambiguous[canonical]) {
    aliases[alias] = canonical;
  }
}

// --- NBA team abbreviations ---
const nbaTeams: Record<string, string> = {
  lal: "lakers", gsw: "warriors", bos: "celtics", mil: "bucks",
  den: "nuggets", phx: "suns", phi: "76ers", mia: "heat",
  dal: "mavericks", lac: "clippers", mem: "grizzlies",
  sac: "kings", nyk: "knicks", cle: "cavaliers", okc: "thunder",
  min: "timberwolves", nop: "pelicans", ind: "pacers",
  atl: "hawks", chi: "bulls", tor: "raptors", orl: "magic",
  hou: "rockets", por: "blazers", sas: "spurs",
  was: "wizards", det: "pistons", cha: "hornets",
  bkn: "nets", uta: "jazz",
};

for (const [abbr, name] of Object.entries(nbaTeams)) {
  if (unique[name] || ambiguous[name]) {
    aliases[abbr] = name;
  }
}

// --- NFL team abbreviations ---
const nflTeams: Record<string, string> = {
  kc: "chiefs", sf: "49ers", bal: "ravens", buf: "bills",
  det: "lions", gb: "packers", phi: "eagles", dal: "cowboys",
  cin: "bengals", jax: "jaguars", pit: "steelers", sea: "seahawks",
  lar: "rams", tb: "buccaneers", nyj: "jets", nyg: "giants",
  ne: "patriots", ten: "titans", car: "panthers", ari: "cardinals",
  lv: "raiders", den: "broncos", lac: "chargers",
};

for (const [abbr, name] of Object.entries(nflTeams)) {
  if (unique[name] || ambiguous[name]) {
    if (!aliases[abbr]) aliases[abbr] = name; // don't overwrite NBA
  }
}

// --- Person nicknames ---
const nicknames: Record<string, string> = {
  // Golf
  rory: "rory mcilroy",
  scottie: "scottie scheffler",
  tiger: "tiger woods",
  spieth: "jordan spieth",
  jt: "justin thomas",
  // Politics
  aoc: "alexandria ocasio-cortez",
  rfk: "robert f. kennedy jr.",
  djt: "donald trump",
  potus: "donald trump",
  kamala: "kamala harris",
  newsom: "gavin newsom",
  desantis: "ron desantis",
  vivek: "vivek ramaswamy",
  // Sports
  lebron: "lebron james",
  steph: "stephen curry",
  giannis: "giannis antetokounmpo",
  luka: "luka doncic",
  mahomes: "patrick mahomes",
  kelce: "travis kelce",
  // Business / Tech
  elon: "elon musk",
  bezos: "jeff bezos",
  zuck: "mark zuckerberg",
  satya: "satya nadella",
  altman: "sam altman",
  // Crypto shorthand
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  // Org abbreviations
  spacex: "spacex",
  tsla: "tesla",
  openai: "openai",
};

for (const [nick, canonical] of Object.entries(nicknames)) {
  const canonLower = canonical.toLowerCase();
  if (unique[canonLower] || ambiguous[canonLower]) {
    aliases[nick] = canonLower;
  }
}

// --- Category keyword aliases ---
aliases["rate decision"] = "fed";
aliases["interest rate"] = "fed";
aliases["fomc"] = "fed";
aliases["federal reserve"] = "fed";
aliases["consumer price index"] = "cpi";
aliases["gross domestic product"] = "gdp";

log(`  Aliases: ${Object.keys(aliases).length}`);

// ---------------------------------------------------------------------------
// Step 4: Validate
// ---------------------------------------------------------------------------

log("Step 4: Validating...");
let issues = 0;

// Every unique entity maps to a valid eventTicker
for (const [entity, data] of Object.entries(unique)) {
  if (!events[data.eventTicker]) {
    warn(`Unique entity "${entity}" -> invalid event ${data.eventTicker}`);
    issues++;
  }
}

// Every ambiguous entity's eventTickers all exist
for (const [entity, tickers] of Object.entries(ambiguous)) {
  for (const t of tickers) {
    if (!events[t]) {
      warn(`Ambiguous entity "${entity}" -> invalid event ${t}`);
      issues++;
    }
  }
}

// Every bigram's eventTicker exists
for (const [bg, ticker] of Object.entries(validBigrams)) {
  if (!events[ticker]) {
    warn(`Bigram "${bg}" -> invalid event ${ticker}`);
    issues++;
  }
}

// No overlap between unique and ambiguous keys
for (const key of Object.keys(unique)) {
  if (ambiguous[key]) {
    warn(`Entity "${key}" is in both unique AND ambiguous`);
    issues++;
  }
}

// All aliases point to entities that exist
for (const [alias, target] of Object.entries(aliases)) {
  if (!unique[target] && !ambiguous[target]) {
    // It's okay if it's a keyword alias (like "fed")
    // Check if it appears in any event title
    const found = Object.values(events).some((e: any) =>
      e.title.toLowerCase().includes(target)
    );
    if (!found) {
      warn(`Alias "${alias}" -> "${target}" not found in entity index or event titles`);
      issues++;
    }
  }
}

if (issues === 0) {
  log("  All validation checks passed");
} else {
  log(`  ${issues} validation issues found`);
}

// ---------------------------------------------------------------------------
// Step 5: Write output
// ---------------------------------------------------------------------------

log("Step 5: Writing matching-index.json...");

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  stats: {
    uniqueEntities: Object.keys(unique).length,
    ambiguousEntities: Object.keys(ambiguous).length,
    bigrams: Object.keys(validBigrams).length,
    aliases: Object.keys(aliases).length,
  },
  unique,
  ambiguous,
  bigrams: validBigrams,
  aliases,
};

writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2));

const sizeMB = (Buffer.byteLength(JSON.stringify(index)) / (1024 * 1024)).toFixed(1);
log(`Output: data/matching-index.json (${sizeMB} MB)`);
log(`  Unique: ${index.stats.uniqueEntities} | Ambiguous: ${index.stats.ambiguousEntities} | Bigrams: ${index.stats.bigrams} | Aliases: ${index.stats.aliases}`);
log("Done.");

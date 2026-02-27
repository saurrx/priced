# Implementation Plan — DFlow Prediction Markets × Twitter Extension

## Project Overview

A Chrome extension that detects tweets about predictable topics and overlays tradeable prediction markets from DFlow (Kalshi on Solana). Uses a hybrid matching architecture: instant in-browser entity matching + batched backend semantic matching with bge-base-en-v1.5.

---

## Phase 1: Matching Index Build
**Goal**: Generate all data files the matching engine needs.
**Duration**: ~3-4 hours
**Dependencies**: Existing `markets-snapshot.json` + `market-analysis.json`
**Outputs**: `matching-index.json`, `event-descriptions.json`

### 1.1 Build Matching Index Script

**File**: `scripts/build-matching-index.ts`
**Runtime**: `npx tsx scripts/build-matching-index.ts`

**What it does**:
- Reads `data/markets-snapshot.json` (1,407 markets, 395 events)
- Reads `data/market-analysis.json` (entities, keywords, clusters)
- Generates `data/matching-index.json`

**matching-index.json structure**:
```jsonc
{
  "version": 1,
  "generatedAt": "2026-02-21T...",
  "stats": { "uniqueEntities": 777, "ambiguousEntities": 252, "bigrams": 150, "aliases": 200 },
  "unique": {
    // entity (lowercase) → { eventTicker, marketTickers[], entityType }
    "kevin warsh": { "eventTicker": "KXFEDCHAIRNOM-29", "marketTickers": ["..."], "entityType": "Person" },
    "scottie scheffler": { "eventTicker": "KXPGATOUR-THGI26", "marketTickers": ["..."], "entityType": "Person/Team" }
  },
  "ambiguous": {
    // entity → eventTickers[]
    "trump": ["KXFEDCHAIRNOM-29", "KXGREENLAND-29", "KXTRUMPRESIGN", "KXIMPEACH"],
    "bitcoin": ["KXBTCMAX150-25", "KXBTCMAXY-26DEC31", "KXBTCMAX100-26"]
  },
  "bigrams": {
    // "entity1 entity2" → eventTicker (disambiguates collisions)
    "trump greenland": "KXGREENLAND-29",
    "trump resign": "KXTRUMPRESIGN",
    "fed cut": "KXFEDDECISION-26MAR",
    "fed chair": "KXFEDCHAIRNOM-29",
    "bitcoin 150": "KXBTCMAX150-25",
    "bitcoin 200": "KXBTC2026200-27JAN01"
  },
  "aliases": {
    // abbreviation/nickname → canonical entity name
    "aoc": "alexandria ocasio-cortez",
    "btc": "bitcoin",
    "$btc": "bitcoin",
    "$eth": "ethereum",
    "$sol": "solana",
    "lal": "lakers",
    "gsw": "warriors",
    "rory": "rory mcilroy",
    "scottie": "scottie scheffler",
    "lebron": "lebron james"
  }
}
```

**Implementation steps**:
1. Load both JSON files
2. Iterate all entities from `market-analysis.json`
3. For entities mapping to exactly 1 event → `unique`
4. For entities mapping to 2+ events → `ambiguous`
5. From collision clusters in analysis → build `bigrams` map
6. Manually curate ~200 aliases (crypto tickers, team abbreviations, nicknames)
7. Write `matching-index.json`

**Validation checks** (run after generation):
- Every unique entity maps to a valid eventTicker that exists in snapshot
- Every ambiguous entity's eventTickers all exist in snapshot
- Every bigram's eventTicker exists in snapshot
- No overlap between unique and ambiguous keys
- Total entities = unique + ambiguous
- All aliases point to entities that exist in unique or ambiguous

### 1.2 Build Event Descriptions Script

**File**: `scripts/build-event-descriptions.ts`
**Runtime**: `npx tsx scripts/build-event-descriptions.ts`

**What it does**:
- Reads `data/markets-snapshot.json`
- For each of 395 events, generates an enriched text description
- Writes `data/event-descriptions.json`

**event-descriptions.json structure**:
```jsonc
{
  "version": 1,
  "events": [
    {
      "eventTicker": "KXFEDCHAIRNOM-29",
      "rawTitle": "Who will Trump nominate as Fed Chair?",
      "enrichedDescription": "Federal Reserve Chair nomination Trump. Fed Chair pick appointment. Kevin Warsh Judy Shelton Rick Rieder candidates. Central bank leadership. Federal Reserve governor nominee confirmation. Who will be the next Fed Chair.",
      "category": "Politics",
      "marketTickers": ["KXFEDCHAIRNOM-29-KW", "KXFEDCHAIRNOM-29-JS", "..."],
      "topEntities": ["kevin warsh", "judy shelton", "rick rieder"]
    }
  ]
}
```

**Enrichment strategy per event**:
1. Start with raw event title
2. Add market `yesSubTitle` values (these contain specific entities)
3. Add category-specific keywords:
   - Sports: team names, league, "championship", "winner", sport name
   - Crypto: ticker symbols, price levels, "bull", "bear", "pump", "dump"
   - Politics: office, candidate names, action verbs
   - Economics: "Fed", "rate", "CPI", "GDP", "inflation", "recession"
4. Add informal phrasing (how people tweet about this topic)
5. Keep under ~100 words per event (longer hurts embedding quality)

**Validation checks**:
- All 395 events have enriched descriptions
- No description exceeds 150 words
- Every eventTicker in descriptions exists in snapshot
- No empty descriptions

### 1.3 Tests for Phase 1

**File**: `scripts/test-matching-index.ts`

**Tests**:
```
✅ matching-index.json passes schema validation
✅ All eventTickers reference valid events in snapshot
✅ No duplicate entities across unique + ambiguous
✅ Alias targets exist in entity index
✅ Bigram targets exist as valid eventTickers
✅ Entity count matches analysis expectations (~777 unique, ~252 ambiguous)
✅ event-descriptions.json has exactly 395 entries
✅ No enriched description is empty or exceeds 150 words
✅ Every event in snapshot has a corresponding description
```

---

## Phase 2: Embedding Generation + Backend API
**Goal**: Stand up the /match endpoint with bge-base-en-v1.5.
**Duration**: ~4-5 hours
**Dependencies**: Phase 1 outputs + Python 3.11+ + Railway account
**Outputs**: Running backend API at `https://<app>.up.railway.app/match`

### 2.1 Generate Event Embeddings

**File**: `server/scripts/generate_embeddings.py`
**Runtime**: `python server/scripts/generate_embeddings.py`

**What it does**:
- Loads `data/event-descriptions.json`
- Embeds all 395 enriched descriptions using `BAAI/bge-base-en-v1.5`
- Saves embeddings as `server/data/event-embeddings.npy` (395 × 768 float32 matrix)

**Implementation**:
```python
from sentence_transformers import SentenceTransformer
import numpy as np
import json

# Load descriptions
with open("data/event-descriptions.json") as f:
    data = json.load(f)

descriptions = [e["enrichedDescription"] for e in data["events"]]
tickers = [e["eventTicker"] for e in data["events"]]

# Load model
# bge-base-en-v1.5: 109M params, 768 dims, MIT license
# HuggingFace: https://huggingface.co/BAAI/bge-base-en-v1.5
# No instruction prefix needed for v1.5 (improved over v1)
model = SentenceTransformer("BAAI/bge-base-en-v1.5")

# Embed all descriptions (normalize for cosine similarity via dot product)
embeddings = model.encode(descriptions, normalize_embeddings=True, show_progress_bar=True)

# Save
np.save("server/data/event-embeddings.npy", embeddings)
with open("server/data/event-tickers.json", "w") as f:
    json.dump(tickers, f)

print(f"Generated {embeddings.shape[0]} embeddings of dim {embeddings.shape[1]}")
# Expected: 395 embeddings of dim 768
```

**Key bge-base-en-v1.5 details**:
- Model card: https://huggingface.co/BAAI/bge-base-en-v1.5
- 109M parameters, 768 embedding dimensions
- Max sequence length: 512 tokens
- License: MIT (commercial use OK)
- v1.5 does NOT require instruction prefix for queries (v1 did)
- But for optimal retrieval, prepend "Represent this sentence:" to queries
- Normalize embeddings → cosine similarity = dot product (faster)
- ONNX version available: https://huggingface.co/BAAI/bge-base-en-v1.5 (onnx/ folder)
- Pre-converted ONNX: https://huggingface.co/Teradata/bge-base-en-v1.5

**Validation checks**:
- Output shape is (395, 768)
- All embeddings are unit-normalized (L2 norm ≈ 1.0 for each)
- Spot-check: cosine similarity between "Fed Chair nomination" and "Bitcoin price" embeddings should be low (<0.3)
- Spot-check: cosine similarity between "Fed Chair nomination" and "Who will Trump pick for Federal Reserve" should be high (>0.7)

### 2.2 Backend API Server

**Directory**: `server/`

**File structure**:
```
server/
├── main.py                    # FastAPI app
├── embedder.py                # Model loading + batch embedding
├── matcher.py                 # Cosine similarity + market selection
├── requirements.txt           # Dependencies
├── Dockerfile                 # For Railway deployment
├── railway.json               # Railway config-as-code
├── data/
│   ├── event-embeddings.npy   # 395×768 embedding matrix
│   ├── event-tickers.json     # Ordered list of event tickers
│   └── markets-snapshot.json  # Full market data (copied from data/)
└── scripts/
    └── generate_embeddings.py # Embedding generation script
```

**requirements.txt**:
```
fastapi==0.115.0
uvicorn==0.30.0
onnxruntime==1.19.0
tokenizers==0.20.0
numpy==1.26.0
```

Note: We use ONNX Runtime + tokenizers directly (NOT sentence-transformers) for production.
sentence-transformers is used only for the one-time embedding generation.
This keeps the Docker image ~400MB smaller and inference faster.

**main.py — FastAPI App**:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from embedder import Embedder
from matcher import Matcher
import time

app = FastAPI(title="DFlow Tweet Matcher")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Lock down after hackathon
    allow_methods=["POST"],
    allow_headers=["*"],
)

embedder = Embedder()
matcher = Matcher()

class Tweet(BaseModel):
    id: str
    text: str

class MatchRequest(BaseModel):
    tweets: list[Tweet]
    candidates: dict[str, list[str]] | None = None  # tweet_id → candidate eventTickers

class MarketMatch(BaseModel):
    ticker: str
    title: str
    yesAsk: float | None
    yesBid: float | None

class TweetMatch(BaseModel):
    id: str
    eventTicker: str
    confidence: float
    markets: list[MarketMatch]

class MatchResponse(BaseModel):
    matches: list[TweetMatch]
    latencyMs: float

@app.post("/match", response_model=MatchResponse)
async def match_tweets(req: MatchRequest):
    start = time.time()

    texts = [t.text for t in req.tweets]
    tweet_ids = [t.id for t in req.tweets]

    # Embed tweets
    tweet_embeddings = embedder.embed_batch(texts)

    # Match against events
    matches = []
    for i, (tweet_id, embedding) in enumerate(zip(tweet_ids, tweet_embeddings)):
        candidates = req.candidates.get(tweet_id) if req.candidates else None
        result = matcher.match(embedding, candidates)
        if result:
            matches.append(TweetMatch(
                id=tweet_id,
                eventTicker=result["eventTicker"],
                confidence=result["confidence"],
                markets=result["markets"]
            ))

    latency = (time.time() - start) * 1000
    return MatchResponse(matches=matches, latencyMs=latency)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "bge-base-en-v1.5",
        "events": matcher.num_events
    }
```

**embedder.py — ONNX Inference**:

Uses ONNX Runtime directly for maximum performance.
Reference: https://onnxruntime.ai/
ONNX model from: https://huggingface.co/BAAI/bge-base-en-v1.5 (onnx/ folder)

```python
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

class Embedder:
    def __init__(self):
        # Load ONNX model
        self.session = ort.InferenceSession(
            "data/model.onnx",
            providers=["CPUExecutionProvider"]
        )
        # Load tokenizer (fast Rust-backed tokenizer from HuggingFace)
        self.tokenizer = Tokenizer.from_pretrained("BAAI/bge-base-en-v1.5")
        self.tokenizer.enable_padding(length=128)
        self.tokenizer.enable_truncation(max_length=128)  # tweets are short

    def embed_batch(self, texts: list[str]) -> np.ndarray:
        # Tokenize batch
        encoded = self.tokenizer.encode_batch(texts)
        input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
        attention_mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)
        token_type_ids = np.zeros_like(input_ids)

        # Run ONNX inference
        outputs = self.session.run(
            None,
            {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "token_type_ids": token_type_ids
            }
        )

        # Mean pooling
        token_embeddings = outputs[0]  # (batch, seq_len, 768)
        mask_expanded = attention_mask[:, :, np.newaxis].astype(np.float32)
        sum_embeddings = np.sum(token_embeddings * mask_expanded, axis=1)
        sum_mask = np.sum(mask_expanded, axis=1)
        embeddings = sum_embeddings / sum_mask

        # Normalize
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / norms

        return embeddings
```

**matcher.py — Similarity + Market Selection**:

```python
import numpy as np
import json

class Matcher:
    def __init__(self):
        self.event_embeddings = np.load("data/event-embeddings.npy")
        with open("data/event-tickers.json") as f:
            self.event_tickers = json.load(f)
        with open("data/markets-snapshot.json") as f:
            self.snapshot = json.load(f)

        # Build event → markets lookup
        self.event_markets = {}
        for market in self.snapshot["markets"]:
            et = market["eventTicker"]
            if et not in self.event_markets:
                self.event_markets[et] = []
            self.event_markets[et].append(market)

        # Build ticker → index lookup
        self.ticker_to_idx = {t: i for i, t in enumerate(self.event_tickers)}

    @property
    def num_events(self):
        return len(self.event_tickers)

    def match(self, embedding: np.ndarray, candidates: list[str] | None = None,
              threshold: float = 0.65) -> dict | None:
        if candidates:
            # Only compare against candidate events
            indices = [self.ticker_to_idx[t] for t in candidates if t in self.ticker_to_idx]
            if not indices:
                return None
            candidate_embeddings = self.event_embeddings[indices]
            scores = embedding @ candidate_embeddings.T
            best_idx = np.argmax(scores)
            best_score = float(scores[best_idx])
            best_ticker = candidates[best_idx]
        else:
            # Compare against all events
            scores = embedding @ self.event_embeddings.T
            best_idx = int(np.argmax(scores))
            best_score = float(scores[best_idx])
            best_ticker = self.event_tickers[best_idx]

        if best_score < threshold:
            return None

        # Select top markets
        markets = self._select_markets(best_ticker)
        if not markets:
            return None

        return {
            "eventTicker": best_ticker,
            "confidence": round(best_score, 3),
            "markets": markets
        }

    def _select_markets(self, event_ticker: str, max_markets: int = 2) -> list[dict]:
        markets = self.event_markets.get(event_ticker, [])
        if not markets:
            return []

        # Filter: skip resolved markets (price < 3¢ or > 97¢)
        viable = [m for m in markets
                   if m.get("yesAsk") and 3 <= m["yesAsk"] <= 97]

        # If no viable markets, try with wider range
        if not viable:
            viable = [m for m in markets if m.get("yesAsk") or m.get("yesBid")]

        # Sort by probability (most uncertain = most interesting)
        viable.sort(key=lambda m: abs(50 - (m.get("yesAsk", 50) or 50)))

        return [
            {
                "ticker": m["marketTicker"],
                "title": m.get("yesSubTitle") or m.get("marketTitle", ""),
                "yesAsk": m.get("yesAsk"),
                "yesBid": m.get("yesBid")
            }
            for m in viable[:max_markets]
        ]
```

**Dockerfile**:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Download ONNX model at build time (cached)
RUN python -c "
from huggingface_hub import hf_hub_download
hf_hub_download('BAAI/bge-base-en-v1.5', 'onnx/model.onnx', local_dir='data/')
"

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Note: For Railway, the port is set via $PORT env var. Update CMD:
```
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
```

**railway.json**:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "server/Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "always"
  }
}
```

**Railway deployment**:
- Railway docs: https://docs.railway.com/guides/fastapi
- Sign up: https://railway.app (GitHub OAuth)
- Create project → Deploy from GitHub repo → auto-detects Dockerfile
- Free tier: $5 credit, always-on, no cold starts
- Expected deploy time: ~2-3 minutes (Docker build + model download cached after first deploy)

### 2.3 Tests for Phase 2

**File**: `server/test_match.py`
**Runtime**: `python -m pytest server/test_match.py -v`

```python
# Test categories:

# 1. Embedding quality tests
def test_embedding_dimensions():
    """Embeddings should be 768-dimensional"""

def test_embedding_normalization():
    """All embeddings should have L2 norm ≈ 1.0"""

def test_similar_texts_high_score():
    """'Fed rate cut' and 'Federal Reserve cutting rates' should score > 0.7"""

def test_dissimilar_texts_low_score():
    """'Fed rate cut' and 'Lakers won the game' should score < 0.3"""

# 2. Matching accuracy tests (against known tweet→event pairs)
KNOWN_MATCHES = [
    ("Kevin Warsh is going to be Fed Chair", "KXFEDCHAIRNOM-29"),
    ("BTC pumping past 95k", "KXBTCMAX100-26"),
    ("no rate cut this time", "KXFEDDECISION-26MAR"),
    ("Scottie Scheffler crushed it today", "KXPGATOUR-THGI26"),
    ("Will GTA 6 be $80?", "KXGTAPRICE-80"),
    ("Oscar nominees are stacked this year", "KXOSCARPIC-26"),
    ("Lakers are going all the way", "KXNBA-26"),
]

KNOWN_NON_MATCHES = [
    "just had amazing pasta for dinner",
    "my dog is the cutest thing ever",
    "feeling grateful today",
    "good morning everyone",
    "lol that's hilarious",
    "can't believe it's already February",
]

def test_known_matches():
    """Each known tweet should match its expected event"""

def test_known_non_matches():
    """Non-market tweets should score below threshold"""

# 3. Batch performance tests
def test_batch_latency():
    """Batch of 10 tweets should complete in < 50ms"""

def test_single_tweet_latency():
    """Single tweet should complete in < 20ms"""

# 4. Market selection tests
def test_market_selection_filters_resolved():
    """Markets at 0-3¢ or 97-100¢ should be filtered out"""

def test_market_selection_max_two():
    """Never return more than 2 markets per match"""

def test_market_selection_prefers_uncertain():
    """Markets near 50¢ should be preferred over 5¢ or 95¢"""

# 5. API integration tests
def test_health_endpoint():
    """GET /health returns 200 with model info"""

def test_match_endpoint_valid():
    """POST /match with valid tweets returns matches"""

def test_match_endpoint_empty():
    """POST /match with no tweets returns empty matches"""

def test_match_endpoint_with_candidates():
    """POST /match with candidates narrows search correctly"""
```

**Performance benchmark** (`server/benchmark.py`):
```python
# Run 100 batches of 10 tweets, measure p50/p95/p99 latency
# Expected: p50 < 15ms, p95 < 30ms, p99 < 50ms
# Also measure: model load time (one-time), memory usage
```

---

## Phase 3: Chrome Extension — Core
**Goal**: Extension that detects tweets and shows market bars.
**Duration**: ~5-6 hours
**Dependencies**: Phase 1 output (`matching-index.json`) + Phase 2 running backend
**Outputs**: Working Chrome extension loaded in developer mode

### 3.1 Extension Structure

**Directory**: `extension/`

```
extension/
├── manifest.json
├── src/
│   ├── content/
│   │   ├── index.ts              # Entry point injected into Twitter
│   │   ├── tweet-observer.ts     # MutationObserver for new tweets
│   │   └── market-bar.ts         # UI injection (bottom bar DOM)
│   ├── matching/
│   │   ├── entity-matcher.ts     # In-browser entity matching
│   │   ├── batch-queue.ts        # Queue + flush + viewport tracking
│   │   └── api-client.ts         # Backend HTTP calls
│   ├── types.ts                  # Shared types
│   └── config.ts                 # Backend URL, thresholds
├── data/
│   └── matching-index.json       # Bundled entity index
├── styles/
│   └── market-bar.css            # Market bar styling
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── build.mjs                     # esbuild script
├── tsconfig.json
└── package.json
```

**manifest.json**:
```json
{
  "manifest_version": 3,
  "name": "Predict Markets",
  "version": "0.1.0",
  "description": "Trade prediction markets directly from Twitter",
  "content_scripts": [{
    "matches": ["https://x.com/*", "https://twitter.com/*"],
    "js": ["content.js"],
    "css": ["styles/market-bar.css"],
    "run_at": "document_idle"
  }],
  "permissions": ["storage"],
  "host_permissions": [
    "https://*.up.railway.app/*"
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

Reference:
- Manifest V3 docs: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- Content scripts: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts

**package.json**:
```json
{
  "name": "predict-markets-extension",
  "private": true,
  "scripts": {
    "build": "node build.mjs",
    "watch": "node build.mjs --watch",
    "test": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "esbuild": "^0.21.0",
    "@types/chrome": "^0.0.268",
    "vitest": "^1.6.0"
  }
}
```

**build.mjs** (esbuild):
```javascript
import { build } from "esbuild";

const isWatch = process.argv.includes("--watch");

const config = {
  entryPoints: ["src/content/index.ts"],
  bundle: true,
  outfile: "dist/content.js",
  target: "chrome120",
  format: "iife",
  minify: !isWatch,
  sourcemap: isWatch,
};

if (isWatch) {
  const ctx = await build({ ...config, plugins: [] });
  // esbuild watch mode rebuilds on file changes
} else {
  await build(config);
}
```

### 3.2 Tweet Observer

**File**: `src/content/tweet-observer.ts`

Detects new tweets appearing in the DOM as the user scrolls.

**X.com/Twitter DOM structure** (as of Feb 2026):
- Tweets are `<article>` elements with `data-testid="tweet"`
- Tweet text is inside `div[data-testid="tweetText"]`
- The timeline is a scrollable div that gets new tweets appended via React virtual list
- MutationObserver on `document.body` with `subtree: true, childList: true` catches all new tweets

**Implementation**:
```typescript
// Watch for new tweet articles appearing in DOM
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) {
        // Find tweet articles in added subtree
        const articles = node.querySelectorAll
          ? node.querySelectorAll('article[data-testid="tweet"]')
          : [];
        articles.forEach(processTweet);

        // Also check if the node itself is a tweet article
        if (node.matches?.('article[data-testid="tweet"]')) {
          processTweet(node);
        }
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
```

**processTweet(article)**:
1. Extract tweet text from `div[data-testid="tweetText"]`
2. Generate a unique ID (hash of text + timestamp, or use tweet link)
3. Check if already processed (Set of processed IDs)
4. If new → pass to matching pipeline

### 3.3 Entity Matcher (In-Browser)

**File**: `src/matching/entity-matcher.ts`

Loads `matching-index.json` at startup and performs instant lookups.

**Key implementation details**:
- Index loaded once from bundled JSON file (~100KB)
- All lookups are O(1) against pre-built Maps
- Normalize tweet text: lowercase, strip emojis, expand aliases
- Check bigrams first (most specific), then unique entities, then ambiguous

```typescript
interface EntityMatchResult {
  type: "unique" | "ambiguous" | "bigram";
  eventTicker?: string;        // set for unique/bigram
  candidateTickers?: string[]; // set for ambiguous
  confidence: number;
  matchedEntity: string;
}

class EntityMatcher {
  private unique: Map<string, {...}>;
  private ambiguous: Map<string, string[]>;
  private bigrams: Map<string, string>;
  private aliases: Map<string, string>;

  constructor(index: MatchingIndex) { /* build maps */ }

  match(tweetText: string): EntityMatchResult | null {
    const normalized = this.normalize(tweetText);
    const tokens = this.tokenize(normalized);

    // Expand aliases
    const expandedTokens = tokens.map(t => this.aliases.get(t) || t);

    // 1. Check bigrams (most specific)
    for (let i = 0; i < expandedTokens.length - 1; i++) {
      const bigram = `${expandedTokens[i]} ${expandedTokens[i+1]}`;
      if (this.bigrams.has(bigram)) {
        return {
          type: "bigram",
          eventTicker: this.bigrams.get(bigram)!,
          confidence: 0.95,
          matchedEntity: bigram
        };
      }
    }

    // 2. Check unique entities (substring match, longest first)
    for (const [entity, data] of this.uniqueSorted) {
      if (normalized.includes(entity)) {
        return {
          type: "unique",
          eventTicker: data.eventTicker,
          confidence: 0.90,
          matchedEntity: entity
        };
      }
    }

    // 3. Check ambiguous entities
    const candidates: string[] = [];
    for (const [entity, tickers] of this.ambiguous) {
      if (normalized.includes(entity)) {
        candidates.push(...tickers);
      }
    }
    if (candidates.length > 0) {
      return {
        type: "ambiguous",
        candidateTickers: [...new Set(candidates)],
        confidence: 0.50,
        matchedEntity: "multiple"
      };
    }

    return null; // No entity match — backend will handle
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s$@#]/g, " ")  // keep $ for tickers
      .replace(/\s+/g, " ")
      .trim();
  }
}
```

### 3.4 Batch Queue + Viewport Tracking

**File**: `src/matching/batch-queue.ts`

```typescript
class BatchQueue {
  private queue: QueuedTweet[] = [];
  private processed = new Set<string>();
  private visibleTweets = new Set<string>();
  private scrollTimer: number | null = null;
  private intersectionObserver: IntersectionObserver;
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;

    // Track which tweets are visible in viewport
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-predict-id");
          if (!id) continue;
          if (entry.isIntersecting) {
            this.visibleTweets.add(id);
          } else {
            this.visibleTweets.delete(id);
          }
        }
      },
      { threshold: 0.3 }  // 30% visible counts
    );

    // Listen for scroll events (debounced flush)
    window.addEventListener("scroll", () => this.onScroll(), { passive: true });
  }

  addTweet(id: string, text: string, element: HTMLElement, entityResult: EntityMatchResult | null) {
    if (this.processed.has(id)) return;

    // Track visibility
    this.intersectionObserver.observe(element);

    this.queue.push({ id, text, element, entityResult, addedAt: Date.now() });

    // Auto-flush if queue gets large
    if (this.queue.length >= 10) {
      this.flush();
    }
  }

  private onScroll() {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => this.flush(), 500);
  }

  private async flush() {
    if (this.queue.length === 0) return;

    // Prioritize visible tweets, drop old invisible ones
    const now = Date.now();
    const batch = this.queue
      .filter(t => this.visibleTweets.has(t.id) || (now - t.addedAt < 5000))
      .slice(0, 15);

    // Mark as processed
    batch.forEach(t => this.processed.add(t.id));
    this.queue = this.queue.filter(t => !this.processed.has(t.id));

    if (batch.length === 0) return;

    // Build candidates map from entity matches
    const candidates: Record<string, string[]> = {};
    for (const t of batch) {
      if (t.entityResult?.type === "ambiguous" && t.entityResult.candidateTickers) {
        candidates[t.id] = t.entityResult.candidateTickers;
      }
    }

    // Call backend
    const results = await this.apiClient.match(
      batch.map(t => ({ id: t.id, text: t.text })),
      Object.keys(candidates).length > 0 ? candidates : undefined
    );

    // Render results
    for (const match of results.matches) {
      const tweet = batch.find(t => t.id === match.id);
      if (tweet) {
        renderMarketBar(tweet.element, match);
      }
    }
  }
}
```

### 3.5 Market Bar UI

**File**: `src/content/market-bar.ts`

Injects a bottom bar into each matched tweet.

**Design**: Bottom bar below the tweet, showing:
- Event title / market question
- YES price (green) / NO price (red)
- "Trade" button (links to DFlow or opens Blink)
- Confidence indicator (subtle)

```typescript
function renderMarketBar(tweetElement: HTMLElement, match: TweetMatch) {
  // Don't re-render if already showing
  if (tweetElement.querySelector(".predict-market-bar")) {
    // Update if better match
    const existing = tweetElement.querySelector(".predict-market-bar");
    // compare confidence, update if higher
    return;
  }

  const bar = document.createElement("div");
  bar.className = "predict-market-bar";
  bar.innerHTML = `
    <div class="predict-bar-inner">
      <div class="predict-market-info">
        <span class="predict-market-title">${match.markets[0].title}</span>
        <span class="predict-market-prices">
          <span class="predict-yes">YES ${match.markets[0].yesAsk}¢</span>
          <span class="predict-no">NO ${100 - (match.markets[0].yesAsk || 50)}¢</span>
        </span>
      </div>
      <button class="predict-trade-btn" data-ticker="${match.markets[0].ticker}">
        Trade
      </button>
    </div>
  `;

  // Insert after tweet content, before engagement buttons
  const tweetContent = tweetElement.querySelector('[data-testid="tweetText"]');
  if (tweetContent?.parentElement) {
    tweetContent.parentElement.insertAdjacentElement("afterend", bar);
  }
}
```

**market-bar.css**: Clean, minimal, dark-mode-compatible styling that matches Twitter's aesthetic.

### 3.6 Tests for Phase 3

**File**: `extension/src/__tests__/entity-matcher.test.ts`
**Runtime**: `npx vitest`

```typescript
// 1. Entity matching tests
describe("EntityMatcher", () => {
  test("unique entity match — 'Scottie Scheffler' → Genesis event", () => {});
  test("unique entity match — case insensitive", () => {});
  test("bigram match — 'trump greenland' → KXGREENLAND-29", () => {});
  test("bigram match — 'fed cut' → KXFEDDECISION-26MAR", () => {});
  test("alias expansion — '$BTC' → bitcoin entities", () => {});
  test("alias expansion — 'rory' → 'rory mcilroy' → Genesis event", () => {});
  test("ambiguous match — 'trump' alone → returns candidates", () => {});
  test("no match — 'had pasta for dinner' → null", () => {});
  test("no match — empty string → null", () => {});
  test("no match — single word 'lol' → null", () => {});
  test("performance — 1000 lookups < 50ms", () => {});
});

// 2. Batch queue tests
describe("BatchQueue", () => {
  test("flushes on size threshold (10 tweets)", () => {});
  test("flushes on scroll pause (500ms)", () => {});
  test("deduplicates processed tweets", () => {});
  test("prioritizes visible tweets", () => {});
  test("drops tweets older than 5 seconds", () => {});
  test("passes ambiguous candidates to backend", () => {});
});

// 3. Market bar rendering tests
describe("MarketBar", () => {
  test("injects bar into tweet element", () => {});
  test("does not duplicate bar on re-render", () => {});
  test("shows correct YES/NO prices", () => {});
  test("trade button has correct ticker", () => {});
});
```

**Manual testing checklist** (on live Twitter):
```
□ Navigate to x.com/home
□ Scroll through timeline
□ Verify market bars appear on relevant tweets
□ Verify no bars on irrelevant tweets (selfies, memes)
□ Verify entity matches appear instantly (<100ms visual)
□ Verify backend matches appear after scroll-pause (~500ms)
□ Open DevTools Network tab → verify batch requests are sent
□ Verify batch size is 5-15 tweets
□ Verify no duplicate requests for same tweet
□ Test on "Following" tab vs "For You" tab
□ Test on a profile page (e.g., @elonmusk)
□ Test on a search results page (e.g., search "bitcoin")
□ Verify extension memory < 5MB (Chrome Task Manager)
```

---

## Phase 4: End-to-End Integration + Tuning
**Goal**: Polish matching quality, tune thresholds, fix edge cases.
**Duration**: ~3-4 hours
**Dependencies**: Phase 1-3 complete
**Outputs**: Production-ready extension with tuned matching

### 4.1 Build Tweet Test Suite

**File**: `tests/tweet-test-suite.json`

50+ real tweets across all categories, with expected match or non-match.

**Categories to cover**:
```jsonc
{
  "tests": [
    // --- SPORTS (15 tweets) ---
    { "text": "Scottie Scheffler just birdied 18 🔥", "expectEvent": "KXPGATOUR-THGI26", "category": "sports-entity" },
    { "text": "Lakers going back to back this year", "expectEvent": "KXNBA-26", "category": "sports-entity" },
    { "text": "what a game tonight holy crap", "expectEvent": null, "category": "sports-vague", "note": "Too vague, should NOT match" },
    // ... 12 more

    // --- POLITICS (10 tweets) ---
    { "text": "Kevin Warsh is 100% getting Fed Chair", "expectEvent": "KXFEDCHAIRNOM-29", "category": "politics-entity" },
    { "text": "no way they hold rates this time", "expectEvent": "KXFEDDECISION-26MAR", "category": "politics-semantic" },
    { "text": "Trump is buying Greenland for real", "expectEvent": "KXGREENLAND-29", "category": "politics-disambiguation" },
    // ... 7 more

    // --- CRYPTO (8 tweets) ---
    { "text": "BTC pumping past 95k, 100k next?", "expectEvent": "KXBTCMAX100-26", "category": "crypto-entity" },
    { "text": "$ETH looking weak below 3k", "expectEvent": null, "category": "crypto-no-market", "note": "We may not have ETH price markets" },
    // ... 6 more

    // --- ENTERTAINMENT (5 tweets) ---
    { "text": "who do you think takes best picture?", "expectEvent": "KXOSCARPIC-26", "category": "entertainment-semantic" },
    // ... 4 more

    // --- ECONOMICS (5 tweets) ---
    { "text": "CPI numbers are going to be wild tomorrow", "expectEvent": "KXCPI-26", "category": "economics-semantic" },
    // ... 4 more

    // --- NON-MATCHES (12 tweets) ---
    { "text": "just had amazing pasta for dinner 🍝", "expectEvent": null, "category": "noise" },
    { "text": "my dog is the cutest thing ever", "expectEvent": null, "category": "noise" },
    { "text": "feeling grateful today ✨", "expectEvent": null, "category": "noise" },
    { "text": "gm", "expectEvent": null, "category": "noise-short" },
    { "text": "lol", "expectEvent": null, "category": "noise-short" },
    { "text": "rt if you agree", "expectEvent": null, "category": "noise-meta" },
    // ... 6 more
  ]
}
```

### 4.2 Run Automated Test Suite

**File**: `tests/run-test-suite.ts`

```typescript
// Load tweet test suite
// For each tweet:
//   1. Run entity matcher locally → get entity result
//   2. Call backend /match → get semantic result
//   3. Compare best result against expected event
//   4. Record: true positive, false positive, true negative, false negative

// Compute metrics:
// Precision = TP / (TP + FP)  — "of matches shown, how many are correct?"
// Recall    = TP / (TP + FN)  — "of matchable tweets, how many did we catch?"
// F1        = 2 * P * R / (P + R)

// Targets:
// Precision > 90%
// Recall > 60% (can be lower — better to miss than show wrong market)
// Zero catastrophic failures (matching noise tweets to markets)
```

### 4.3 Threshold Tuning

Based on test suite results, adjust:

1. **Backend confidence threshold** (currently 0.65)
   - If too many false positives → raise to 0.70 or 0.75
   - If too many false negatives → lower to 0.60
   - May need different thresholds per category (sports vs politics vs crypto)

2. **Entity match confidence levels**
   - Bigram: 0.95 (very reliable)
   - Unique entity: 0.90 (reliable but could be entity in wrong context)
   - Ambiguous: 0.50 (needs backend disambiguation)

3. **Market selection filters**
   - Price floor/ceiling: currently 3¢/97¢, may need adjustment
   - Max markets per tweet: currently 2

4. **Missing aliases / entities**
   - Run test suite → identify false negatives
   - Add missing aliases (new nicknames, ticker symbols)
   - Add missing entities from tweets that should have matched

### 4.4 Tests for Phase 4

```
✅ Full test suite passes with Precision > 90%
✅ Full test suite passes with Recall > 60%
✅ Zero noise tweets matched to any market
✅ Ambiguous entities correctly disambiguated by backend
✅ Entity matcher handles edge cases: emojis, URLs, @mentions, #hashtags
✅ Backend returns within 100ms for batch of 10
✅ Extension memory stays under 5MB during 10-minute browsing session
✅ No console errors during normal browsing
```

---

## Phase 5: Trade Integration (Post-Hackathon or If Time Allows)
**Goal**: Wire "Trade" button to DFlow trade flow.
**Duration**: ~4-6 hours
**Dependencies**: Phases 1-4 + Phantom wallet + DFlow API access

### 5.1 Trade Flow

DFlow API docs: https://pond.dflow.net/concepts/prediction/prediction-markets
Trade API: https://pond.dflow.net/build/prediction-markets

When user clicks "Trade" on a market bar:

1. **Check wallet connection** — is Phantom installed and connected?
2. **Get quote** from DFlow Trade API:
   ```
   GET https://dev-quote-api.dflow.net/order
     ?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  (USDC)
     &outputMint={yesMint from market}
     &amount={USDC amount in lamports}
     &userPublicKey={wallet address}
     &slippageBps=100
   ```
3. **Display confirmation**: Show price, amount, estimated fee
4. **Send transaction** to Phantom for signing
5. **Monitor execution**: sync (instant) or async (wait for fill)

### 5.2 Solana Blinks Alternative

Solana Actions/Blinks: https://solana.com/docs/advanced/actions

Instead of building full trade UI, generate a Blink URL that opens in the user's wallet. Simpler for hackathon demo. Trade button → opens Blink URL → wallet handles the rest.

### 5.3 Platform Fee Integration

```
platformFeeScale=50   // 5% platform fee
feeAccount={our USDC token account}
```

Add to every trade request. Revenue collected automatically.

---

## File Manifest (Complete Project)

```
lisbon/
├── data/
│   ├── markets-snapshot.json          # ✅ Exists (1,407 markets)
│   ├── market-analysis.json           # ✅ Exists (entity/keyword analysis)
│   ├── matching-index.json            # Phase 1.1
│   └── event-descriptions.json        # Phase 1.2
│
├── server/
│   ├── main.py                        # Phase 2.2
│   ├── embedder.py                    # Phase 2.2
│   ├── matcher.py                     # Phase 2.2
│   ├── requirements.txt               # Phase 2.2
│   ├── Dockerfile                     # Phase 2.2
│   ├── railway.json                   # Phase 2.2
│   ├── test_match.py                  # Phase 2.3
│   ├── benchmark.py                   # Phase 2.3
│   ├── data/
│   │   ├── event-embeddings.npy       # Phase 2.1
│   │   ├── event-tickers.json         # Phase 2.1
│   │   ├── markets-snapshot.json      # Copy of data/
│   │   └── model.onnx                 # Downloaded at build time
│   └── scripts/
│       └── generate_embeddings.py     # Phase 2.1
│
├── extension/
│   ├── manifest.json                  # Phase 3.1
│   ├── package.json                   # Phase 3.1
│   ├── tsconfig.json                  # Phase 3.1
│   ├── build.mjs                      # Phase 3.1
│   ├── src/
│   │   ├── content/
│   │   │   ├── index.ts              # Phase 3.2
│   │   │   ├── tweet-observer.ts     # Phase 3.2
│   │   │   └── market-bar.ts         # Phase 3.5
│   │   ├── matching/
│   │   │   ├── entity-matcher.ts     # Phase 3.3
│   │   │   ├── batch-queue.ts        # Phase 3.4
│   │   │   └── api-client.ts         # Phase 3.4
│   │   ├── types.ts                  # Phase 3.1
│   │   └── config.ts                 # Phase 3.1
│   ├── data/
│   │   └── matching-index.json       # Copy of data/
│   ├── styles/
│   │   └── market-bar.css            # Phase 3.5
│   └── icons/                        # Phase 3.1
│
├── tests/
│   ├── tweet-test-suite.json          # Phase 4.1
│   └── run-test-suite.ts             # Phase 4.2
│
└── scripts/
    ├── build-matching-index.ts        # Phase 1.1
    ├── build-event-descriptions.ts    # Phase 1.2
    └── test-matching-index.ts         # Phase 1.3
```

---

## Critical Links & References

| Resource | URL |
|----------|-----|
| bge-base-en-v1.5 Model | https://huggingface.co/BAAI/bge-base-en-v1.5 |
| bge-base-en-v1.5 ONNX | https://huggingface.co/Teradata/bge-base-en-v1.5 |
| ONNX Runtime (Python) | https://onnxruntime.ai/ |
| sentence-transformers docs | https://sbert.net/docs/sentence_transformer/usage/efficiency.html |
| FastAPI docs | https://fastapi.tiangolo.com/ |
| Railway deploy (FastAPI) | https://docs.railway.com/guides/fastapi |
| Railway pricing | https://railway.app/pricing ($5 free credit) |
| Chrome Extension MV3 | https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3 |
| Content Scripts reference | https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts |
| DFlow Prediction Markets | https://pond.dflow.net/concepts/prediction/prediction-markets |
| DFlow Trade API | https://pond.dflow.net/build/prediction-markets |
| DFlow Data Model | https://pond.dflow.net/build/prediction-markets/prediction-market-data-model |
| Solana Actions/Blinks | https://solana.com/docs/advanced/actions |
| esbuild docs | https://esbuild.github.io/ |
| vitest docs | https://vitest.dev/ |
| HuggingFace tokenizers | https://huggingface.co/docs/tokenizers/ |

---

## Estimated Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1: Matching Index | 3-4 hrs | 3-4 hrs |
| Phase 2: Backend API | 4-5 hrs | 7-9 hrs |
| Phase 3: Extension Core | 5-6 hrs | 12-15 hrs |
| Phase 4: Integration + Tuning | 3-4 hrs | 15-19 hrs |
| Phase 5: Trade Integration | 4-6 hrs | 19-25 hrs |
| **Total** | | **15-25 hrs** |

Phases 1-4 are the complete product (matching + display). Phase 5 (trading) is a bonus.

For the hackathon demo, Phases 1-4 are sufficient to show:
- Extension detecting tweets about prediction markets
- Market bars appearing with live prices
- Both instant (entity) and async (semantic) matching working
- The "wow" moment when a vague tweet gets matched

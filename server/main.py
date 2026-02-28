"""Jupiter Tweet Matcher — FastAPI backend.

POST /match   — Match tweets to prediction market events
POST /prices  — Fetch live prices from Jupiter for specific market IDs
GET  /market/{marketId} — Get market details by Jupiter marketId
GET  /health  — Health check
GET  /admin   — Admin dashboard
"""

import asyncio
import os
import re
import secrets
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from embedder import Embedder
from matcher import Matcher
from reranker import Reranker
import access_db

JUP_API = "https://api.jup.ag/prediction/v1"
JUP_API_KEY = os.environ.get("JUP_API_KEY", "5f6da690-eb02-4aed-858b-3c034f0b490d")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")
_admin_tokens: set[str] = set()

access_db.init_db()

app = FastAPI(title="Jupiter Tweet Matcher")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Lock down after hackathon
    allow_methods=["POST", "GET", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

embedder = Embedder()

try:
    reranker = Reranker()
    print("[MAIN] Cross-encoder reranker loaded")
except Exception as e:
    print(f"[MAIN] Reranker unavailable, falling back to cosine-sim only: {e}")
    reranker = None

matcher = Matcher(reranker=reranker)


class Tweet(BaseModel):
    id: str
    text: str


class MatchRequest(BaseModel):
    tweets: list[Tweet]
    candidates: dict[str, list[str]] | None = None


class MarketMatch(BaseModel):
    marketId: str
    eventId: str
    title: str
    eventTitle: str = ""
    eventSubtitle: str = ""
    category: str = ""
    imageUrl: str = ""
    buyYesPriceUsd: int | None = None
    sellYesPriceUsd: int | None = None
    buyNoPriceUsd: int | None = None
    sellNoPriceUsd: int | None = None
    volume: int | None = None
    closeTime: int | None = None


class TweetMatch(BaseModel):
    id: str
    eventId: str
    confidence: float
    markets: list[MarketMatch]
    totalMarkets: int | None = None


class MatchResponse(BaseModel):
    matches: list[TweetMatch]
    latencyMs: float


URL_RE = re.compile(r"https?://\S+|\S+\.\S+/\S+")
MIN_TEXT_LENGTH = 30


def clean_tweet_text(text: str) -> str:
    """Strip URLs and excess whitespace from tweet text."""
    return URL_RE.sub("", text).strip()


@app.post("/match", response_model=MatchResponse)
async def match_tweets(req: MatchRequest):
    start = time.time()

    raw_texts = [t.text for t in req.tweets]
    tweet_ids = [t.id for t in req.tweets]

    # Clean texts for embedding/matching (strip URLs)
    texts = [clean_tweet_text(t) for t in raw_texts]

    # Skip tweets that are too short after cleaning
    valid = [(i, tid, txt) for i, (tid, txt) in enumerate(zip(tweet_ids, texts)) if len(txt) >= MIN_TEXT_LENGTH]
    if not valid:
        latency = (time.time() - start) * 1000
        return MatchResponse(matches=[], latencyMs=latency)

    valid_texts = [txt for _, _, txt in valid]
    tweet_embeddings = embedder.embed_batch(valid_texts)

    matches = []
    for j, (_, tweet_id, text) in enumerate(valid):
        embedding = tweet_embeddings[j]
        candidates = req.candidates.get(tweet_id) if req.candidates else None
        result = matcher.match(embedding, candidates, tweet_text=text)
        if result:
            matches.append(
                TweetMatch(
                    id=tweet_id,
                    eventId=result["eventId"],
                    confidence=result["confidence"],
                    markets=[MarketMatch(**m) for m in result["markets"]],
                    totalMarkets=result.get("totalMarkets"),
                )
            )

    latency = (time.time() - start) * 1000
    return MatchResponse(matches=matches, latencyMs=latency)


@app.get("/market/{market_id}")
async def get_market_by_id(market_id: str):
    result = matcher.get_market_by_id(market_id)
    if not result:
        return {"error": "Market not found"}
    return result


class PricesRequest(BaseModel):
    marketIds: list[str]


class MarketPrice(BaseModel):
    buyYesPriceUsd: int | None = None
    buyNoPriceUsd: int | None = None
    volume: int | None = None


@app.post("/prices")
async def get_live_prices(req: PricesRequest):
    """Fetch live prices from Jupiter API for up to 6 market IDs."""
    ids = req.marketIds[:6]

    async def fetch_one(client: httpx.AsyncClient, market_id: str):
        try:
            resp = await client.get(
                f"{JUP_API}/markets/{market_id}",
                headers={"x-api-key": JUP_API_KEY},
                timeout=5.0,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            pricing = data.get("pricing", data)
            return (
                market_id,
                {
                    "buyYesPriceUsd": pricing.get("buyYesPriceUsd"),
                    "buyNoPriceUsd": pricing.get("buyNoPriceUsd"),
                    "volume": pricing.get("volume"),
                },
            )
        except Exception:
            return None

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(fetch_one(client, mid) for mid in ids))

    prices = {}
    for r in results:
        if r:
            prices[r[0]] = r[1]

    return {"prices": prices}


@app.post("/reload")
async def reload_data(request: Request):
    """Hot-reload market data + embeddings without restarting the server."""
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    global matcher
    try:
        new_matcher = Matcher(reranker=reranker)
        old_count = matcher.num_events
        matcher = new_matcher
        return {
            "status": "ok",
            "previousEvents": old_count,
            "newEvents": matcher.num_events,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


class ValidateAccessRequest(BaseModel):
    code: str


@app.post("/validate-access")
async def validate_access(req: ValidateAccessRequest):
    code = req.code.strip()
    if not code:
        return {"valid": False, "reason": "not_found"}
    valid, reason = access_db.validate_code(code)
    return {"valid": valid, "reason": reason}


# ── Admin endpoints ──────────────────────────────────────────────

def _check_admin(request: Request) -> bool:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:] in _admin_tokens
    return False


@app.get("/admin", response_class=HTMLResponse)
async def admin_page():
    html = (Path(__file__).parent / "admin.html").read_text()
    return HTMLResponse(html)


class AdminLoginRequest(BaseModel):
    password: str


@app.post("/admin/login")
async def admin_login(req: AdminLoginRequest):
    if req.password == ADMIN_PASSWORD:
        token = secrets.token_hex(32)
        _admin_tokens.add(token)
        return {"token": token}
    return JSONResponse({"error": "invalid"}, status_code=401)


@app.post("/admin/logout")
async def admin_logout(request: Request):
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        _admin_tokens.discard(auth[7:])
    return {"ok": True}


@app.get("/admin/api/codes")
async def admin_list_codes(request: Request):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return access_db.list_codes()


class CreateCodeRequest(BaseModel):
    code: str
    max_uses: int = 0


@app.post("/admin/api/codes")
async def admin_create_code(req: CreateCodeRequest, request: Request):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    ok = access_db.create_code(req.code.strip(), req.max_uses)
    if not ok:
        return JSONResponse({"error": "code already exists"}, status_code=409)
    return {"ok": True}


class UpdateCodeRequest(BaseModel):
    max_uses: int | None = None
    active: bool | None = None


@app.patch("/admin/api/codes/{code}")
async def admin_update_code(code: str, req: UpdateCodeRequest, request: Request):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    access_db.update_code(code, max_uses=req.max_uses, active=req.active)
    return {"ok": True}


@app.post("/admin/api/codes/{code}/reset")
async def admin_reset_code(code: str, request: Request):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    access_db.reset_usage(code)
    return {"ok": True}


@app.delete("/admin/api/codes/{code}")
async def admin_delete_code(code: str, request: Request):
    if not _check_admin(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    access_db.delete_code(code)
    return {"ok": True}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "source": "jupiter",
        "model": "bge-base-en-v1.5",
        "reranker": "gte-reranker-modernbert-base" if reranker else None,
        "events": matcher.num_events,
    }

"""Jupiter Tweet Matcher — FastAPI backend.

POST /match  — Match tweets to prediction market events
GET  /market/{marketId} — Get market details by Jupiter marketId
GET  /health — Health check
"""

import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from embedder import Embedder
from matcher import Matcher

app = FastAPI(title="Jupiter Tweet Matcher")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Lock down after hackathon
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

embedder = Embedder()
matcher = Matcher()


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


class MatchResponse(BaseModel):
    matches: list[TweetMatch]
    latencyMs: float


@app.post("/match", response_model=MatchResponse)
async def match_tweets(req: MatchRequest):
    start = time.time()

    texts = [t.text for t in req.tweets]
    tweet_ids = [t.id for t in req.tweets]

    tweet_embeddings = embedder.embed_batch(texts)

    matches = []
    for i, (tweet_id, embedding) in enumerate(zip(tweet_ids, tweet_embeddings)):
        candidates = req.candidates.get(tweet_id) if req.candidates else None
        result = matcher.match(embedding, candidates)
        if result:
            matches.append(
                TweetMatch(
                    id=tweet_id,
                    eventId=result["eventId"],
                    confidence=result["confidence"],
                    markets=[MarketMatch(**m) for m in result["markets"]],
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


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "source": "jupiter",
        "model": "bge-base-en-v1.5",
        "events": matcher.num_events,
    }

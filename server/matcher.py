"""Cosine similarity matching + market selection for Jupiter markets."""

import json
import os
import re
import time
import numpy as np

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


class Matcher:
    def __init__(self, reranker=None):
        self.reranker = reranker

        self.event_embeddings = np.load(os.path.join(DATA_DIR, "event-embeddings.npy"))

        with open(os.path.join(DATA_DIR, "event-tickers.json")) as f:
            self.event_ids: list[str] = json.load(f)

        with open(os.path.join(DATA_DIR, "markets-snapshot.json")) as f:
            self.snapshot = json.load(f)

        # Load raw event texts for cross-encoder reranking
        if self.reranker:
            with open(os.path.join(DATA_DIR, "embedding-texts.json")) as f:
                self.embedding_texts: list[str] = json.load(f)

        # Build event -> markets lookup
        self.event_markets: dict[str, list[dict]] = {}
        for market in self.snapshot["markets"].values():
            eid = market["eventId"]
            if eid not in self.event_markets:
                self.event_markets[eid] = []
            self.event_markets[eid].append(market)

        # Build eventId -> index lookup
        self.id_to_idx = {eid: i for i, eid in enumerate(self.event_ids)}

        # Build marketId -> market lookup
        self.market_by_id: dict[str, dict] = {}
        for market in self.snapshot["markets"].values():
            self.market_by_id[market["marketId"]] = market

    @property
    def num_events(self) -> int:
        return len(self.event_ids)

    def _has_viable_markets(self, event_id: str) -> bool:
        """Check if event has at least one open, tradeable market."""
        markets = self.event_markets.get(event_id, [])
        now_unix = int(time.time())
        return any(
            m.get("buyYesPriceUsd") is not None
            and 30000 <= m["buyYesPriceUsd"] <= 970000
            and (m.get("closeTime") is None or m["closeTime"] > now_unix)
            for m in markets
        )

    def match(
        self,
        embedding: np.ndarray,
        candidates: list[str] | None = None,
        threshold: float = 0.75,
        tweet_text: str | None = None,
        rerank_top_n: int = 8,
        rerank_threshold: float = 0.83,
        cosine_gate: float = 0.65,
        cosine_scan: int = 50,
        min_match_cosine: float = 0.72,
    ) -> dict | None:
        if candidates:
            indices = [self.id_to_idx[eid] for eid in candidates if eid in self.id_to_idx]
            if not indices:
                return None
            candidate_embeddings = self.event_embeddings[indices]
            scores = embedding @ candidate_embeddings.T
            ranked = np.argsort(scores)[::-1]
            ranked_ids = [candidates[i] for i in ranked]
            ranked_indices = [indices[i] for i in ranked]
        else:
            scores = embedding @ self.event_embeddings.T
            ranked = np.argsort(scores)[::-1]
            ranked_ids = [self.event_ids[i] for i in ranked]
            ranked_indices = [int(i) for i in ranked]

        # Cross-encoder reranking: score top-N VIABLE candidates
        if self.reranker and tweet_text:
            # Stage 1: cosine gate — loose filter to eliminate junk before
            # expensive reranking (short/generic tweets score <0.65 cosine)
            best_cosine = float(scores[ranked[0]]) if len(ranked) > 0 else 0.0
            if best_cosine < cosine_gate:
                return None

            # Stage 2: collect top viable candidates from cosine ranking.
            # Scan beyond top-10 because ~30% of events have expired markets.
            viable_ids = []
            viable_indices = []
            viable_cosines = []
            scan_limit = min(cosine_scan, len(ranked_ids))
            for i in range(scan_limit):
                eid = ranked_ids[i]
                if self._has_viable_markets(eid):
                    viable_ids.append(eid)
                    viable_indices.append(ranked_indices[i])
                    viable_cosines.append(float(scores[ranked_indices[i]]))
                    if len(viable_ids) >= rerank_top_n:
                        break

            if not viable_ids:
                return None

            # Stage 3: cross-encoder reranking on viable candidates only
            documents = [self.embedding_texts[i] for i in viable_indices]
            rerank_scores = self.reranker.score_pairs(tweet_text, documents)

            reranked_order = np.argsort(rerank_scores)[::-1]
            ranked_ids = [viable_ids[i] for i in reranked_order]
            ranked_scores = [float(rerank_scores[i]) for i in reranked_order]
            ranked_cosines = [viable_cosines[i] for i in reranked_order]
            threshold = rerank_threshold
        else:
            if candidates:
                ranked_scores = [float(scores[i]) for i in np.argsort(scores)[::-1]]
            else:
                ranked_scores = [float(scores[i]) for i in ranked]

        # Return best match above threshold.
        # When reranker is active, also check that the cosine similarity
        # for the winning event is high enough — low cosine + high reranker
        # usually means the reranker matched on keywords, not meaning.
        use_cosine_check = self.reranker and tweet_text
        for i, (event_id, score) in enumerate(zip(ranked_ids, ranked_scores)):
            if score < threshold:
                return None
            if use_cosine_check and ranked_cosines[i] < min_match_cosine:
                continue

            selection = self._select_markets(event_id)
            if selection["items"]:
                return {
                    "eventId": event_id,
                    "confidence": round(score, 3),
                    "markets": selection["items"],
                    "totalMarkets": selection["totalMarkets"],
                }

        return None

    def get_market_by_id(self, market_id: str) -> dict | None:
        market = self.market_by_id.get(market_id)
        if not market:
            return None
        return {
            "marketId": market["marketId"],
            "eventId": market["eventId"],
            "title": market.get("title", ""),
            "eventTitle": market.get("eventTitle", ""),
            "eventSubtitle": market.get("eventSubtitle", ""),
            "category": market.get("category", ""),
            "imageUrl": market.get("imageUrl", ""),
            "buyYesPriceUsd": market.get("buyYesPriceUsd"),
            "sellYesPriceUsd": market.get("sellYesPriceUsd"),
            "buyNoPriceUsd": market.get("buyNoPriceUsd"),
            "sellNoPriceUsd": market.get("sellNoPriceUsd"),
            "volume": market.get("volume"),
            "closeTime": market.get("closeTime"),
            "rulesPrimary": market.get("rulesPrimary", ""),
        }

    def _select_markets(self, event_id: str, max_markets: int = 6) -> dict:
        markets = self.event_markets.get(event_id, [])
        if not markets:
            return {"items": [], "totalMarkets": 0}

        now_unix = int(time.time())

        # Filter: skip closed markets and near-resolved markets (price < 3c or > 97c)
        # Jupiter prices are in micro-USD: 30000 = $0.03, 970000 = $0.97
        viable = [
            m
            for m in markets
            if m.get("buyYesPriceUsd") is not None
            and 30000 <= m["buyYesPriceUsd"] <= 970000
            and (m.get("closeTime") is None or m["closeTime"] > now_unix)
        ]

        # Fallback: any open market with pricing
        if not viable:
            viable = [
                m
                for m in markets
                if m.get("buyYesPriceUsd") is not None
                and (m.get("closeTime") is None or m["closeTime"] > now_unix)
            ]

        # Sort by uncertainty (closest to 50c = $0.50 = 500000 micro-USD)
        viable.sort(
            key=lambda m: abs(500000 - (m.get("buyYesPriceUsd") or 500000))
        )

        return {
            "items": [
                {
                    "marketId": m["marketId"],
                    "eventId": m["eventId"],
                    "title": m.get("title", ""),
                    "eventTitle": m.get("eventTitle", ""),
                    "eventSubtitle": m.get("eventSubtitle", ""),
                    "category": m.get("category", ""),
                    "imageUrl": m.get("imageUrl", ""),
                    "buyYesPriceUsd": m.get("buyYesPriceUsd"),
                    "sellYesPriceUsd": m.get("sellYesPriceUsd"),
                    "buyNoPriceUsd": m.get("buyNoPriceUsd"),
                    "sellNoPriceUsd": m.get("sellNoPriceUsd"),
                    "volume": m.get("volume"),
                    "closeTime": m.get("closeTime"),
                }
                for m in viable[:max_markets]
            ],
            "totalMarkets": len(viable),
        }

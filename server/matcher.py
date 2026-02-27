"""Cosine similarity matching + market selection for Jupiter markets."""

import json
import os
import numpy as np

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


class Matcher:
    def __init__(self):
        self.event_embeddings = np.load(os.path.join(DATA_DIR, "event-embeddings.npy"))

        with open(os.path.join(DATA_DIR, "event-tickers.json")) as f:
            self.event_ids: list[str] = json.load(f)

        with open(os.path.join(DATA_DIR, "markets-snapshot.json")) as f:
            self.snapshot = json.load(f)

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

    def match(
        self,
        embedding: np.ndarray,
        candidates: list[str] | None = None,
        threshold: float = 0.75,
    ) -> dict | None:
        if candidates:
            indices = [self.id_to_idx[eid] for eid in candidates if eid in self.id_to_idx]
            if not indices:
                return None
            candidate_embeddings = self.event_embeddings[indices]
            scores = embedding @ candidate_embeddings.T
            best_idx = int(np.argmax(scores))
            best_score = float(scores[best_idx])
            best_event_id = candidates[best_idx]
        else:
            scores = embedding @ self.event_embeddings.T
            best_idx = int(np.argmax(scores))
            best_score = float(scores[best_idx])
            best_event_id = self.event_ids[best_idx]

        if best_score < threshold:
            return None

        markets = self._select_markets(best_event_id)
        if not markets:
            return None

        return {
            "eventId": best_event_id,
            "confidence": round(best_score, 3),
            "markets": markets,
        }

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

    def _select_markets(self, event_id: str, max_markets: int = 2) -> list[dict]:
        markets = self.event_markets.get(event_id, [])
        if not markets:
            return []

        # Filter: skip near-resolved markets (price < 3c or > 97c)
        # Jupiter prices are in micro-USD: 30000 = $0.03, 970000 = $0.97
        viable = [
            m
            for m in markets
            if m.get("buyYesPriceUsd") is not None
            and 30000 <= m["buyYesPriceUsd"] <= 970000
        ]

        # Fallback: any market with pricing
        if not viable:
            viable = [m for m in markets if m.get("buyYesPriceUsd") is not None]

        # Sort by uncertainty (closest to 50c = $0.50 = 500000 micro-USD)
        viable.sort(
            key=lambda m: abs(500000 - (m.get("buyYesPriceUsd") or 500000))
        )

        return [
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
        ]

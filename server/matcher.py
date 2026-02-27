"""Cosine similarity matching + market selection."""

import json
import os
import numpy as np

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


class Matcher:
    def __init__(self):
        self.event_embeddings = np.load(os.path.join(DATA_DIR, "event-embeddings.npy"))

        with open(os.path.join(DATA_DIR, "event-tickers.json")) as f:
            self.event_tickers: list[str] = json.load(f)

        with open(os.path.join(DATA_DIR, "markets-snapshot.json")) as f:
            self.snapshot = json.load(f)

        # Build event -> markets lookup
        self.event_markets: dict[str, list[dict]] = {}
        for market in self.snapshot["markets"].values():
            et = market["eventTicker"]
            if et not in self.event_markets:
                self.event_markets[et] = []
            self.event_markets[et].append(market)

        # Build ticker -> index lookup
        self.ticker_to_idx = {t: i for i, t in enumerate(self.event_tickers)}

        # Build mint -> market lookup
        self.mint_to_market: dict[str, dict] = {}
        for market in self.snapshot["markets"].values():
            if market.get("yesMint"):
                self.mint_to_market[market["yesMint"]] = market
            if market.get("noMint"):
                self.mint_to_market[market["noMint"]] = market

    @property
    def num_events(self) -> int:
        return len(self.event_tickers)

    def match(
        self,
        embedding: np.ndarray,
        candidates: list[str] | None = None,
        threshold: float = 0.75,
    ) -> dict | None:
        if candidates:
            indices = [self.ticker_to_idx[t] for t in candidates if t in self.ticker_to_idx]
            if not indices:
                return None
            candidate_embeddings = self.event_embeddings[indices]
            scores = embedding @ candidate_embeddings.T
            best_idx = int(np.argmax(scores))
            best_score = float(scores[best_idx])
            best_ticker = candidates[best_idx]
        else:
            scores = embedding @ self.event_embeddings.T
            best_idx = int(np.argmax(scores))
            best_score = float(scores[best_idx])
            best_ticker = self.event_tickers[best_idx]

        if best_score < threshold:
            return None

        markets = self._select_markets(best_ticker)
        if not markets:
            return None

        return {
            "eventTicker": best_ticker,
            "confidence": round(best_score, 3),
            "markets": markets,
        }

    def get_market_by_mint(self, mint: str) -> dict | None:
        market = self.mint_to_market.get(mint)
        if not market:
            return None
        yes_mint = market.get("yesMint")
        is_yes = yes_mint == mint
        return {
            "ticker": market["ticker"],
            "title": market.get("title", ""),
            "yesSubTitle": market.get("yesSubTitle", ""),
            "eventTitle": market.get("eventTitle", ""),
            "eventSubtitle": market.get("eventSubtitle", ""),
            "side": "YES" if is_yes else "NO",
            "yesAsk": market.get("yesAsk"),
            "yesBid": market.get("yesBid"),
            "noAsk": market.get("noAsk"),
            "noBid": market.get("noBid"),
            "yesMint": yes_mint,
            "noMint": market.get("noMint"),
            "volume": market.get("volume"),
            "openInterest": market.get("openInterest"),
            "closeTime": market.get("closeTime"),
        }

    def _select_markets(self, event_ticker: str, max_markets: int = 2) -> list[dict]:
        markets = self.event_markets.get(event_ticker, [])
        if not markets:
            return []

        # Filter: skip near-resolved markets (price < 3c or > 97c)
        viable = [
            m
            for m in markets
            if m.get("yesAsk") is not None and 3 <= m["yesAsk"] <= 97
        ]

        # Fallback: any market with some price info
        if not viable:
            viable = [m for m in markets if m.get("yesAsk") is not None or m.get("yesBid") is not None]

        # Sort by uncertainty (closest to 50c = most interesting)
        viable.sort(key=lambda m: abs(50 - (m.get("yesAsk") or m.get("yesBid") or 50)))

        return [
            {
                "ticker": m["ticker"],
                "title": m.get("title", ""),
                "yesSubTitle": m.get("yesSubTitle", ""),
                "eventTitle": m.get("eventTitle", ""),
                "eventSubtitle": m.get("eventSubtitle", ""),
                "yesAsk": m.get("yesAsk"),
                "yesBid": m.get("yesBid"),
                "noAsk": m.get("noAsk"),
                "noBid": m.get("noBid"),
                "yesMint": m.get("yesMint"),
                "noMint": m.get("noMint"),
                "volume": m.get("volume"),
                "openInterest": m.get("openInterest"),
                "closeTime": m.get("closeTime"),
            }
            for m in viable[:max_markets]
        ]

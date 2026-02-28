import { MATCH_ENDPOINT, PRICES_ENDPOINT } from "../config";
import type { MatchResponse } from "../types";

export interface LivePrice {
  buyYesPriceUsd: number | null;
  buyNoPriceUsd: number | null;
  volume?: number | null;
}

export class ApiClient {
  async match(
    tweets: { id: string; text: string }[]
  ): Promise<MatchResponse> {
    try {
      const res = await fetch(MATCH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweets }),
      });

      if (!res.ok) {
        console.warn(`[Predict] Backend returned ${res.status}`);
        return { matches: [], latencyMs: 0 };
      }

      return await res.json();
    } catch (err) {
      console.warn("[Predict] Backend unreachable:", err);
      return { matches: [], latencyMs: 0 };
    }
  }

  async fetchPrices(
    marketIds: string[]
  ): Promise<Record<string, LivePrice>> {
    try {
      const res = await fetch(PRICES_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketIds }),
      });

      if (!res.ok) return {};
      const data = await res.json();
      return data.prices ?? {};
    } catch {
      return {};
    }
  }
}

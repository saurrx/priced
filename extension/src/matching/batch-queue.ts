import {
  BATCH_SIZE,
  FLUSH_DELAY_MS,
  MAX_BATCH_SIZE,
  TWEET_MAX_AGE_MS,
  MATCH_STATS_KEY,
  PAUSED_STORAGE_KEY,
} from "../config";
import type { QueuedTweet } from "../types";
import { ApiClient } from "./api-client";
import { renderMarketBar } from "../content/market-bar";

export class BatchQueue {
  private queue: QueuedTweet[] = [];
  private processed = new Set<string>();
  private visibleTweets = new Set<string>();
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private intersectionObserver: IntersectionObserver;
  private apiClient: ApiClient;
  private paused = false;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;

    // Load initial pause state
    chrome.storage.local.get(PAUSED_STORAGE_KEY, (result) => {
      this.paused = result[PAUSED_STORAGE_KEY] === true;
    });

    // React to pause toggle changes from popup
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[PAUSED_STORAGE_KEY]) {
        this.paused = changes[PAUSED_STORAGE_KEY].newValue === true;
      }
    });

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.predictId;
          if (!id) continue;
          if (entry.isIntersecting) {
            this.visibleTweets.add(id);
          } else {
            this.visibleTweets.delete(id);
          }
        }
      },
      { threshold: 0.3 }
    );

    window.addEventListener("scroll", () => this.onScroll(), {
      passive: true,
    });
  }

  addTweet(id: string, text: string, element: HTMLElement) {
    if (this.processed.has(id)) return;

    // Track visibility
    element.dataset.predictId = id;
    this.intersectionObserver.observe(element);

    this.queue.push({ id, text, element, addedAt: Date.now() });

    if (this.queue.length >= BATCH_SIZE) {
      this.flush();
    }
  }

  private onScroll() {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  private async flush() {
    if (this.paused) return;
    if (this.queue.length === 0) return;

    const now = Date.now();

    // Prioritize visible tweets, drop old invisible ones
    const batch = this.queue
      .filter(
        (t) =>
          !this.processed.has(t.id) &&
          (this.visibleTweets.has(t.id) || now - t.addedAt < TWEET_MAX_AGE_MS)
      )
      .slice(0, MAX_BATCH_SIZE);

    for (const t of batch) this.processed.add(t.id);
    this.queue = this.queue.filter((t) => !this.processed.has(t.id));

    if (batch.length === 0) return;

    // Send all tweets to backend — no candidates filtering, pure semantic
    const results = await this.apiClient.match(
      batch.map((t) => ({ id: t.id, text: t.text }))
    );

    for (const match of results.matches) {
      const tweet = batch.find((t) => t.id === match.id);
      if (tweet && match.markets.length > 0) {
        renderMarketBar(tweet.element, match, this.apiClient);
        this.recordMatch(tweet.text, match.markets[0]);
      }
    }

  }

  private recordMatch(tweetText: string, market: { title: string; eventTitle?: string; marketId: string; buyYesPriceUsd: number | null; buyNoPriceUsd: number | null }) {
    const today = new Date().toISOString().slice(0, 10);
    chrome.storage.local.get(MATCH_STATS_KEY, (result) => {
      const stats = result[MATCH_STATS_KEY] || {};
      const matchedDate = stats.matchedDate || "";
      const matchedToday = matchedDate === today ? (stats.matchedToday || 0) + 1 : 1;

      chrome.storage.local.set({
        [MATCH_STATS_KEY]: {
          matchedToday,
          matchedDate: today,
          lastMatch: {
            tweetText: tweetText.slice(0, 200),
            marketTitle: market.eventTitle || market.title,
            marketId: market.marketId,
            buyYesPriceUsd: market.buyYesPriceUsd,
            buyNoPriceUsd: market.buyNoPriceUsd,
            matchedAt: Date.now(),
          },
        },
      });
    });
  }
}

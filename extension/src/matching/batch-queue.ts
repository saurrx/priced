import {
  BATCH_SIZE,
  FLUSH_DELAY_MS,
  MAX_BATCH_SIZE,
  TWEET_MAX_AGE_MS,
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

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;

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
      console.log(
        `[Predict] Backend match: tweet="${match.id}" → event=${match.eventId} confidence=${match.confidence} market=${match.markets[0]?.marketId}`
      );
      const tweet = batch.find((t) => t.id === match.id);
      if (tweet && match.markets.length > 0) {
        renderMarketBar(tweet.element, match);
      }
    }

    console.log(
      `[Predict] Backend: ${results.matches.length} matches from ${batch.length} tweets, latency=${results.latencyMs?.toFixed(0)}ms`
    );
  }
}

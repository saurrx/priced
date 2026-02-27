export interface MarketMatch {
  marketId: string;
  eventId: string;
  title: string;
  eventTitle?: string;
  eventSubtitle?: string;
  category?: string;
  imageUrl?: string;
  buyYesPriceUsd: number | null;
  sellYesPriceUsd?: number | null;
  buyNoPriceUsd?: number | null;
  sellNoPriceUsd?: number | null;
  volume?: number | null;
  closeTime?: number | null;
}

export interface TweetMatch {
  id: string;
  eventId: string;
  confidence: number;
  markets: MarketMatch[];
}

export interface MatchResponse {
  matches: TweetMatch[];
  latencyMs: number;
}

export interface QueuedTweet {
  id: string;
  text: string;
  element: HTMLElement;
  addedAt: number;
}

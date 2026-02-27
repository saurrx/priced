export interface MarketMatch {
  ticker: string;
  title: string;
  yesSubTitle?: string;
  eventTitle?: string;
  eventSubtitle?: string;
  yesAsk: number | null;
  yesBid: number | null;
  noAsk?: number | null;
  noBid?: number | null;
  yesMint?: string | null;
  noMint?: string | null;
  volume?: number | null;
  openInterest?: number | null;
  closeTime?: string | null;
}

export interface TweetMatch {
  id: string;
  eventTicker: string;
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

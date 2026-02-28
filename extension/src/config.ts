export const BACKEND_URL = "https://api.seerum.ai";
export const MATCH_ENDPOINT = `${BACKEND_URL}/match`;
export const PRICES_ENDPOINT = `${BACKEND_URL}/prices`;
export const BATCH_SIZE = 10;
export const FLUSH_DELAY_MS = 500;
export const TWEET_MAX_AGE_MS = 5000;
export const MAX_BATCH_SIZE = 15;
export const MIN_TWEET_LENGTH = 30;
export const ACTIONS_SERVER_URL = "https://api.seerum.ai";

// Access code gating
export const ACCESS_STORAGE_KEY = "seerum_access";
export const ACCESS_VALIDATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Match stats & pause
export const MATCH_STATS_KEY = "seerum_match_stats";
export const PAUSED_STORAGE_KEY = "seerum_paused";

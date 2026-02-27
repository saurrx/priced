import type { TweetMatch, MarketMatch } from "../types";
import { ACTIONS_SERVER_URL } from "../config";

export function renderMarketBar(tweetElement: HTMLElement, match: TweetMatch) {
  const existing = tweetElement.querySelector(".predict-market-bar") as HTMLElement | null;

  // If we already have a bar, update only if new match has better confidence
  if (existing) {
    const existingConf = parseFloat(existing.dataset.confidence || "0");
    if (match.confidence <= existingConf) return;
    existing.remove();
  }

  // If no markets yet, show a minimal loading bar
  if (match.markets.length === 0) {
    const bar = document.createElement("div");
    bar.className = "predict-market-bar predict-loading";
    bar.dataset.confidence = String(match.confidence);
    bar.innerHTML = `
      <div class="predict-bar-collapsed">
        <span class="predict-dot">\u25CF</span>
        <span class="predict-market-title">Finding market...</span>
      </div>
    `;
    insertBar(tweetElement, bar);
    return;
  }

  const market = match.markets[0];

  // Jupiter prices in micro-USD: 650000 = $0.65 = 65¢
  const yesPrice = market.buyYesPriceUsd;
  const noPrice = market.buyNoPriceUsd;
  const yesCents = yesPrice != null ? Math.round(yesPrice / 10000) : null;
  const noCents = noPrice != null ? Math.round(noPrice / 10000) : null;
  const confidencePct = Math.round(match.confidence * 100);

  // Use eventTitle for the main display, fallback to market title
  const displayTitle = market.eventTitle || market.title;
  const expandedTitle = displayTitle;
  const expandedSubtitle = market.eventSubtitle || "";

  // Close time formatting
  const closeDisplay = market.closeTime ? formatCloseTime(market.closeTime) : null;

  // Volume (Jupiter volume is raw number, not micro-USD)
  const volume = market.volume ? formatVolume(market.volume) : null;

  // Footer meta items
  const metaParts: string[] = [];
  if (volume) metaParts.push(`Vol: ${volume}`);
  if (closeDisplay) metaParts.push(closeDisplay);

  // Jupiter uses marketId — one blink URL with side query param
  const blinkBaseUrl = `${ACTIONS_SERVER_URL}/api/actions/trade/${market.marketId}`;
  const yesBlinkUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(blinkBaseUrl + "?amount=2000000&side=yes")}`;
  const noBlinkUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(blinkBaseUrl + "?amount=2000000&side=no")}`;

  const bar = document.createElement("div");
  bar.className = "predict-market-bar";
  bar.dataset.confidence = String(match.confidence);
  bar.dataset.expanded = "false";

  bar.innerHTML = `
    <div class="predict-bar-collapsed">
      <span class="predict-dot">\u25CF</span>
      <span class="predict-market-title">${escapeHtml(displayTitle)}</span>
      <span class="predict-prices">
        ${yesCents !== null ? `<span class="predict-yes">YES ${yesCents}\u00A2</span>` : ""}
        ${noCents !== null ? `<span class="predict-no">NO ${noCents}\u00A2</span>` : ""}
      </span>
      <span class="predict-expand-arrow">\u25B2</span>
    </div>
    <div class="predict-bar-expanded">
      <div class="predict-expanded-header">
        <div class="predict-expanded-title-group">
          ${expandedTitle !== displayTitle ? `<span class="predict-expanded-title">${escapeHtml(expandedTitle)}</span>` : ""}
          ${expandedSubtitle ? `<span class="predict-expanded-subtitle">${escapeHtml(expandedSubtitle)}</span>` : ""}
        </div>
      </div>
      <div class="predict-trade-buttons">
        <a class="predict-buy-yes"
           href="${yesBlinkUrl}"
           target="_blank"
           rel="noopener noreferrer"
           data-market-id="${escapeHtml(market.marketId)}">
          Buy YES <span>${yesCents !== null ? `${yesCents}\u00A2` : ""}</span>
        </a>
        <a class="predict-buy-no"
           href="${noBlinkUrl}"
           target="_blank"
           rel="noopener noreferrer"
           data-market-id="${escapeHtml(market.marketId)}">
          Buy NO <span>${noCents !== null ? `${noCents}\u00A2` : ""}</span>
        </a>
      </div>
      <div class="predict-footer">
        ${metaParts.length > 0 ? `<span class="predict-meta">${metaParts.join(" \u00B7 ")}</span>` : ""}
        <a href="https://x.com/seerumai" target="_blank" rel="noopener noreferrer" class="predict-powered-header">
          <svg class="seerum-icon" viewBox="0 0 100 100" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
            <path fill="#FFFF00" d="M96 50 C80 75 55 90 30 90 L20 100 L25 85 C15 75 5 60 5 50 C5 40 15 25 25 15 L20 0 L30 10 C55 10 80 25 96 50 Z" />
            <circle cx="45" cy="50" r="20" fill="#000" />
            <circle cx="50" cy="45" r="5" fill="#FFF" />
          </svg>
          Powered by @seerumAI
        </a>
      </div>
    </div>
  `;

  // Prevent click from propagating to tweet
  bar.addEventListener("click", (e) => e.stopPropagation());

  // Expand/collapse handler
  const collapsed = bar.querySelector(".predict-bar-collapsed") as HTMLElement;
  collapsed.addEventListener("click", (e) => {
    e.preventDefault();
    const expanded = bar.querySelector(".predict-bar-expanded") as HTMLElement;
    const arrow = bar.querySelector(".predict-expand-arrow") as HTMLElement;
    const isExpanded = bar.dataset.expanded === "true";

    if (isExpanded) {
      expanded.style.display = "none";
      arrow.textContent = "\u25B2";
      bar.dataset.expanded = "false";
    } else {
      expanded.style.display = "block";
      arrow.textContent = "\u25BC";
      bar.dataset.expanded = "true";
    }
  });

  insertBar(tweetElement, bar);
}

function insertBar(tweetElement: HTMLElement, bar: HTMLElement) {
  const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
  if (tweetText?.parentElement) {
    tweetText.parentElement.insertAdjacentElement("afterend", bar);
    return;
  }
  tweetElement.appendChild(bar);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol}`;
}

function formatCloseTime(closeTime: number): string {
  const close = new Date(closeTime * 1000); // Jupiter uses Unix seconds
  const now = new Date();
  const diffMs = close.getTime() - now.getTime();

  if (diffMs < 0) return "Closed";

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 1) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    return diffHours <= 1 ? "Closes <1h" : `Closes in ${diffHours}h`;
  }
  if (diffDays <= 30) return `Closes in ${diffDays}d`;

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Closes ${monthNames[close.getMonth()]} ${close.getFullYear()}`;
}

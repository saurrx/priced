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
  const yesPrice = market.yesAsk ?? market.yesBid ?? null;
  const noPrice = market.noBid ?? (market.noAsk != null ? market.noAsk : (yesPrice !== null ? 100 - yesPrice : null));
  const confidencePct = Math.round(match.confidence * 100);

  // Smart title: use market title (the question), not yesSubTitle (outcome label)
  const displayTitle = market.title;

  // Expanded header: use eventTitle if it adds context beyond the market title
  const expandedTitle = market.eventTitle && market.eventTitle !== market.title
    ? market.eventTitle
    : market.title;
  const expandedSubtitle = market.eventSubtitle || "";

  // Show yesSubTitle as context in expanded view IF it adds info
  // Skip if it's just a date or repeats the title
  const showSubTitle = market.yesSubTitle
    && market.yesSubTitle !== market.title
    && !market.yesSubTitle.startsWith("Before ");

  // Spread: only show if both bid and ask exist
  const spread = (market.yesAsk != null && market.yesBid != null)
    ? market.yesAsk - market.yesBid
    : null;

  // Close time formatting
  const closeDisplay = market.closeTime ? formatCloseTime(market.closeTime) : null;

  // Volume
  const volume = market.volume ? formatVolume(market.volume) : null;

  // Footer meta items
  const metaParts: string[] = [];
  if (volume) metaParts.push(`Vol: ${volume}`);
  if (spread !== null) metaParts.push(`Spread: ${spread}\u00A2`);
  if (closeDisplay) metaParts.push(closeDisplay);

  const yesBlinkUrl = market.yesMint
    ? `https://dial.to/?action=solana-action:${encodeURIComponent(`${ACTIONS_SERVER_URL}/api/actions/trade/${market.yesMint}`)}`
    : "#";
  const noBlinkUrl = market.noMint
    ? `https://dial.to/?action=solana-action:${encodeURIComponent(`${ACTIONS_SERVER_URL}/api/actions/trade/${market.noMint}`)}`
    : "#";

  const bar = document.createElement("div");
  bar.className = "predict-market-bar";
  bar.dataset.confidence = String(match.confidence);
  bar.dataset.expanded = "false";

  bar.innerHTML = `
    <div class="predict-bar-collapsed">
      <span class="predict-dot">\u25CF</span>
      <span class="predict-market-title">${escapeHtml(displayTitle)}</span>
      <span class="predict-prices">
        ${yesPrice !== null ? `<span class="predict-yes">YES ${yesPrice}\u00A2</span>` : ""}
        ${noPrice !== null ? `<span class="predict-no">NO ${noPrice}\u00A2</span>` : ""}
      </span>
      <span class="predict-expand-arrow">\u25B2</span>
    </div>
    <div class="predict-bar-expanded">
      <div class="predict-expanded-header">
        <div class="predict-expanded-title-group">
          <span class="predict-expanded-title">${escapeHtml(expandedTitle)}</span>
          ${expandedSubtitle ? `<span class="predict-expanded-subtitle">${escapeHtml(expandedSubtitle)}</span>` : ""}
          ${showSubTitle ? `<span class="predict-expanded-subtitle">${escapeHtml(market.yesSubTitle!)}</span>` : ""}
        </div>
        <span class="predict-confidence-badge">${confidencePct}% match</span>
      </div>
      <div class="predict-trade-buttons">
        <a class="predict-buy-yes"
           href="${yesBlinkUrl}"
           target="_blank"
           rel="noopener noreferrer"
           data-mint="${escapeHtml(market.yesMint ?? "")}">
          Buy YES <span>${yesPrice !== null ? `${yesPrice}\u00A2` : ""}</span>
        </a>
        <a class="predict-buy-no"
           href="${noBlinkUrl}"
           target="_blank"
           rel="noopener noreferrer"
           data-mint="${escapeHtml(market.noMint ?? "")}">
          Buy NO <span>${noPrice !== null ? `${noPrice}\u00A2` : ""}</span>
        </a>
      </div>
      <div class="predict-footer">
        ${metaParts.length > 0 ? `<span class="predict-meta">${metaParts.join(" \u00B7 ")}</span>` : ""}
        <span class="predict-powered">Powered by Kalshi \u00D7 DFlow on Solana</span>
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
  // Try to insert after tweet text content
  const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
  if (tweetText?.parentElement) {
    tweetText.parentElement.insertAdjacentElement("afterend", bar);
    return;
  }

  // Fallback: append to the article
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

function formatCloseTime(closeTime: string): string {
  const close = new Date(closeTime);
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

import type { TweetMatch, MarketMatch } from "../types";
import { ACTIONS_SERVER_URL } from "../config";
import type { ApiClient, LivePrice } from "../matching/api-client";

export function renderMarketBar(tweetElement: HTMLElement, match: TweetMatch, apiClient: ApiClient) {
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
  const isBinary = match.markets.length === 1;
  const displayTitle = market.eventTitle || market.title;

  // Close time & volume from first market (shared across event)
  const closeDisplay = market.closeTime ? formatCloseTime(market.closeTime) : null;
  const volume = market.volume ? formatVolume(market.volume) : null;
  const metaParts: string[] = [];
  if (volume) metaParts.push(`Vol: ${volume}`);
  if (closeDisplay) metaParts.push(closeDisplay);

  const bar = document.createElement("div");
  bar.className = "predict-market-bar";
  bar.dataset.confidence = String(match.confidence);
  bar.dataset.expanded = "false";
  bar.dataset.marketIds = match.markets.map((m) => m.marketId).join(",");

  if (isBinary) {
    bar.innerHTML = buildBinaryHtml(market, displayTitle, metaParts);
  } else {
    bar.innerHTML = buildMultiHtml(match.markets, displayTitle, metaParts, match.totalMarkets);
  }

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

      // Fetch live prices on expand (debounce 10s)
      const lastFetch = parseInt(bar.dataset.pricesAt || "0", 10);
      if (Date.now() - lastFetch > 10_000) {
        refreshPrices(bar, isBinary, apiClient);
      }
    }
  });

  insertBar(tweetElement, bar);
}

/* ── Live price refresh ── */
async function refreshPrices(bar: HTMLElement, isBinary: boolean, apiClient: ApiClient) {
  const ids = (bar.dataset.marketIds || "").split(",").filter(Boolean);
  if (ids.length === 0) return;

  const prices = await apiClient.fetchPrices(ids);
  bar.dataset.pricesAt = String(Date.now());

  if (Object.keys(prices).length === 0) return;

  if (isBinary) {
    const mid = ids[0];
    const p = prices[mid];
    if (p) updateBinaryPrices(bar, p);
  } else {
    for (const mid of ids) {
      const p = prices[mid];
      if (p) updateMultiPrices(bar, mid, p);
    }
  }
}

function updateBinaryPrices(bar: HTMLElement, p: LivePrice) {
  const yesFmt = formatCents(p.buyYesPriceUsd);
  const noFmt = formatCents(p.buyNoPriceUsd);
  const prob = formatProbability(p.buyYesPriceUsd, p.buyNoPriceUsd);

  // Collapsed bar — show probability %
  const yesEl = bar.querySelector(".predict-yes");
  const noEl = bar.querySelector(".predict-no");
  if (yesEl && prob) {
    yesEl.textContent = `YES ${prob.yes}%`;
    flashElement(yesEl);
  }
  if (noEl && prob) {
    noEl.textContent = `NO ${prob.no}%`;
    flashElement(noEl);
  }

  // Expanded buttons — show buy price ¢
  const buyYesSpan = bar.querySelector(".predict-buy-yes span");
  const buyNoSpan = bar.querySelector(".predict-buy-no span");
  if (buyYesSpan && yesFmt !== null) {
    buyYesSpan.textContent = `${yesFmt}\u00A2`;
    flashElement(buyYesSpan);
  }
  if (buyNoSpan && noFmt !== null) {
    buyNoSpan.textContent = `${noFmt}\u00A2`;
    flashElement(buyNoSpan);
  }
}

function updateMultiPrices(bar: HTMLElement, marketId: string, p: LivePrice) {
  const row = bar.querySelector(`.predict-outcome-row[data-market-id="${marketId}"]`);
  if (!row) return;

  const yesFmt = formatCents(p.buyYesPriceUsd);
  const noFmt = formatCents(p.buyNoPriceUsd);
  const prob = formatProbability(p.buyYesPriceUsd, p.buyNoPriceUsd);

  // Probability %
  const pctEl = row.querySelector(".predict-outcome-pct");
  if (pctEl && prob) {
    pctEl.textContent = `${prob.yes}%`;
    flashElement(pctEl);
  }

  // Buy price ¢
  const pillYes = row.querySelector(".predict-pill-yes");
  if (pillYes && yesFmt !== null) {
    pillYes.textContent = `Yes ${yesFmt}\u00A2`;
    flashElement(pillYes);
  }

  const pillNo = row.querySelector(".predict-pill-no");
  if (pillNo && noFmt !== null) {
    pillNo.textContent = `No ${noFmt}\u00A2`;
    flashElement(pillNo);
  }
}

function flashElement(el: Element) {
  el.classList.remove("predict-price-updated");
  void (el as HTMLElement).offsetWidth; // force reflow
  el.classList.add("predict-price-updated");
  setTimeout(() => el.classList.remove("predict-price-updated"), 600);
}

/* ── Binary market layout (single YES/NO outcome) ── */
function buildBinaryHtml(market: MarketMatch, displayTitle: string, metaParts: string[]): string {
  const yesFmt = formatCents(market.buyYesPriceUsd);
  const noFmt = formatCents(market.buyNoPriceUsd);
  const prob = formatProbability(market.buyYesPriceUsd, market.buyNoPriceUsd);

  const blinkBase = `${ACTIONS_SERVER_URL}/api/actions/trade/${market.marketId}`;
  const yesUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(blinkBase + "?amount=2000000&side=yes")}`;
  const noUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(blinkBase + "?amount=2000000&side=no")}`;

  return `
    <div class="predict-bar-collapsed">
      <span class="predict-dot">\u25CF</span>
      <span class="predict-market-title">${esc(displayTitle)}</span>
      <span class="predict-prices">
        ${prob ? `<span class="predict-yes">YES ${prob.yes}%</span>` : ""}
        ${prob ? `<span class="predict-no">NO ${prob.no}%</span>` : ""}
      </span>
      <span class="predict-expand-arrow">\u25B2</span>
    </div>
    <div class="predict-bar-expanded" style="display:none">
      <div class="predict-expanded-header">
        <div class="predict-expanded-title-group">
          <span class="predict-expanded-title">${esc(displayTitle)}</span>
        </div>
      </div>
      <div class="predict-trade-buttons">
        <a class="predict-buy-yes" href="${yesUrl}" target="_blank" rel="noopener noreferrer">
          Buy YES <span>${yesFmt !== null ? `${yesFmt}\u00A2` : ""}</span>
        </a>
        <a class="predict-buy-no" href="${noUrl}" target="_blank" rel="noopener noreferrer">
          Buy NO <span>${noFmt !== null ? `${noFmt}\u00A2` : ""}</span>
        </a>
      </div>
      ${footerHtml(metaParts)}
    </div>
  `;
}

/* ── Multi-outcome market layout (outcome list) ── */
function buildMultiHtml(markets: MarketMatch[], displayTitle: string, metaParts: string[], totalOutcomes?: number): string {
  const rows = markets.map((m) => {
    const yesFmt = formatCents(m.buyYesPriceUsd);
    const noFmt = formatCents(m.buyNoPriceUsd);
    const prob = formatProbability(m.buyYesPriceUsd, m.buyNoPriceUsd);
    const pct = prob ? `${prob.yes}%` : "";

    const blinkBase = `${ACTIONS_SERVER_URL}/api/actions/trade/${m.marketId}`;
    const yesUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(blinkBase + "?amount=2000000&side=yes")}`;
    const noUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(blinkBase + "?amount=2000000&side=no")}`;

    return `
      <div class="predict-outcome-row" data-market-id="${m.marketId}">
        <span class="predict-outcome-name">${esc(m.title)}</span>
        <span class="predict-outcome-pct">${pct}</span>
        <div class="predict-outcome-actions">
          <a class="predict-pill-yes" href="${yesUrl}" target="_blank" rel="noopener noreferrer">
            Yes ${yesFmt !== null ? `${yesFmt}\u00A2` : ""}
          </a>
          ${noFmt !== null ? `<a class="predict-pill-no" href="${noUrl}" target="_blank" rel="noopener noreferrer">
            No ${noFmt}\u00A2
          </a>` : ""}
        </div>
      </div>
    `;
  }).join("");

  const total = totalOutcomes ?? markets.length;
  const remaining = total - markets.length;
  const moreRow = remaining > 0
    ? `<div class="predict-outcome-row predict-outcome-more"><span class="predict-outcome-name">+${remaining} more outcome${remaining > 1 ? "s" : ""}</span></div>`
    : "";

  return `
    <div class="predict-bar-collapsed">
      <span class="predict-dot">\u25CF</span>
      <span class="predict-market-title">${esc(displayTitle)}</span>
      <span class="predict-outcome-count">${total} outcomes</span>
      <span class="predict-expand-arrow">\u25B2</span>
    </div>
    <div class="predict-bar-expanded" style="display:none">
      <div class="predict-expanded-header">
        <div class="predict-expanded-title-group">
          <span class="predict-expanded-title">${esc(displayTitle)}</span>
        </div>
      </div>
      <div class="predict-outcome-list">
        ${rows}
        ${moreRow}
      </div>
      ${footerHtml(metaParts)}
    </div>
  `;
}

/* ── Shared helpers ── */
function footerHtml(metaParts: string[]): string {
  return `
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
  `;
}

function insertBar(tweetElement: HTMLElement, bar: HTMLElement) {
  // X's virtual scroll can detach article elements between queue and render.
  // If the stored reference is stale, re-find the tweet in the live DOM.
  const target = tweetElement.isConnected ? tweetElement : refindTweet(tweetElement);
  if (!target) return;

  const tweetText = target.querySelector('[data-testid="tweetText"]');
  if (tweetText?.parentElement) {
    tweetText.parentElement.insertAdjacentElement("afterend", bar);
    return;
  }
  target.appendChild(bar);
}

function refindTweet(staleElement: HTMLElement): HTMLElement | null {
  const staleText = staleElement.querySelector('[data-testid="tweetText"]')?.textContent?.trim();
  if (!staleText) return null;

  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim();
    if (text === staleText) return article as HTMLElement;
  }
  return null;
}

function esc(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatCents(microUsd: number | null | undefined): string | null {
  if (microUsd == null || microUsd === 0) return null;
  const cents = Math.round(microUsd / 10000);
  if (cents <= 0) return "<1";
  return String(cents);
}

function formatProbability(buyYes: number | null | undefined, buyNo: number | null | undefined): { yes: string; no: string } | null {
  if (!buyYes || !buyNo) return null;
  const yPct = Math.round(buyYes / (buyYes + buyNo) * 100);
  const nPct = 100 - yPct;
  return { yes: String(yPct), no: String(nPct) };
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol}`;
}

function formatCloseTime(closeTime: number): string {
  const close = new Date(closeTime * 1000);
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

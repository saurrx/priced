import {
  BACKEND_URL,
  ACCESS_STORAGE_KEY,
  ACCESS_VALIDATION_TTL_MS,
  MATCH_STATS_KEY,
  PAUSED_STORAGE_KEY,
} from "./config";

interface StoredAccess {
  code: string;
  validatedAt: number;
}

interface MatchStats {
  matchedToday: number;
  matchedDate: string;
  lastMatch?: {
    tweetText: string;
    marketTitle: string;
    marketId: string;
    buyYesPriceUsd: number | null;
    buyNoPriceUsd: number | null;
    matchedAt: number;
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  const accessSection = document.getElementById("access-section")!;
  const connectedSection = document.getElementById("connected-section")!;
  const codeInput = document.getElementById("access-code-input") as HTMLInputElement;
  const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
  const btnText = document.getElementById("btn-text")!;
  const btnSpinner = document.getElementById("btn-spinner")!;
  const errorMsg = document.getElementById("error-msg")!;
  const disconnectBtn = document.getElementById("disconnect-btn")!;
  const pauseToggle = document.getElementById("pause-toggle") as HTMLInputElement;
  const statusDot = document.getElementById("status-dot")!;
  const statusLabel = document.getElementById("status-label")!;

  // Check access on load
  const stored = await getStoredAccess();
  if (stored && Date.now() - stored.validatedAt < ACCESS_VALIDATION_TTL_MS) {
    showDashboard();
  } else if (stored) {
    // Re-validate expired code (don't increment usage — just check validity)
    const res = await validateCode(stored.code);
    if (res.valid) {
      await storeAccess(stored.code);
      showDashboard();
    } else {
      await clearAccess();
      showAccessForm();
    }
  } else {
    showAccessForm();
  }

  // Event listeners
  submitBtn.addEventListener("click", handleSubmit);
  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });

  disconnectBtn.addEventListener("click", async () => {
    await clearAccess();
    showAccessForm();
  });

  pauseToggle.addEventListener("change", () => {
    const paused = !pauseToggle.checked;
    chrome.storage.local.set({ [PAUSED_STORAGE_KEY]: paused });
    updateToggleUI(paused);
  });

  async function handleSubmit() {
    const code = codeInput.value.trim();
    if (!code) {
      showError("Please enter an invite code");
      return;
    }

    btnText.textContent = "Verifying...";
    btnSpinner.style.display = "inline-block";
    submitBtn.disabled = true;
    hideError();

    try {
      const res = await validateCode(code);
      if (res.valid) {
        await storeAccess(code);
        showDashboard();
      } else {
        if (res.reason === "exhausted") {
          showError("Verification failed \u2014 code has been fully used");
        } else {
          showError("Verification failed \u2014 code is invalid");
        }
      }
    } catch {
      showError("Could not verify. Check your connection.");
    } finally {
      btnText.textContent = "Activate";
      btnSpinner.style.display = "none";
      submitBtn.disabled = false;
    }
  }

  function showAccessForm() {
    accessSection.style.display = "flex";
    connectedSection.style.display = "none";
    codeInput.value = "";
    hideError();
  }

  async function showDashboard() {
    accessSection.style.display = "none";
    connectedSection.style.display = "flex";

    // Load pause state
    const pauseResult = await chromeGet(PAUSED_STORAGE_KEY);
    const paused = pauseResult[PAUSED_STORAGE_KEY] === true;
    pauseToggle.checked = !paused;
    updateToggleUI(paused);

    // Load match stats from storage
    const statsResult = await chromeGet(MATCH_STATS_KEY);
    const stats: MatchStats | null = statsResult[MATCH_STATS_KEY] || null;
    populateStats(stats);

    // Fetch live markets count from server (async, non-blocking)
    fetchLiveMarkets();
  }

  function updateToggleUI(paused: boolean) {
    if (paused) {
      statusDot.className = "dash-status-dot dash-status-dot--paused";
      statusLabel.className = "dash-status-label dash-status-label--paused";
      statusLabel.textContent = "Paused";
    } else {
      statusDot.className = "dash-status-dot dash-status-dot--active";
      statusLabel.className = "dash-status-label dash-status-label--active";
      statusLabel.textContent = "Active";
    }
  }

  function populateStats(stats: MatchStats | null) {
    const matchedTodayEl = document.getElementById("stat-matched-today")!;
    const lastMatchContainer = document.getElementById("last-match-container")!;

    const today = new Date().toISOString().slice(0, 10);
    const todayCount = stats?.matchedDate === today ? stats.matchedToday : 0;
    matchedTodayEl.textContent = String(todayCount);

    if (stats?.lastMatch) {
      const m = stats.lastMatch;
      const yesCents = m.buyYesPriceUsd ? Math.round(m.buyYesPriceUsd / 10000) : null;
      const noCents = m.buyNoPriceUsd ? Math.round(m.buyNoPriceUsd / 10000) : null;

      lastMatchContainer.innerHTML = `
        <div class="last-match-card">
          <div class="last-match-tweet">${escHtml(m.tweetText)}</div>
          <div class="last-match-market">
            <span class="last-match-brand">PRICED</span>
            <span class="last-match-title">${escHtml(m.marketTitle)}</span>
            <div class="last-match-prices">
              ${yesCents !== null ? `<span class="last-match-pill last-match-pill--yes">YES<br>${yesCents}\u00A2</span>` : ""}
              ${noCents !== null ? `<span class="last-match-pill last-match-pill--no">NO<br>${noCents}\u00A2</span>` : ""}
            </div>
          </div>
        </div>
      `;
    } else {
      lastMatchContainer.innerHTML = `
        <div class="last-match-placeholder">
          <p>No matches yet \u2014 only tweets relevant to active markets get matched. Browse X or try this one:</p>
          <a class="last-match-try-link" href="https://x.com/FoxNews/status/2025536170587799938" target="_blank" rel="noopener noreferrer">
            <span>Try this tweet \u2192 @FoxNews \u2014 see Priced in action</span>
            <span class="last-match-try-arrow">\u2197</span>
          </a>
        </div>
      `;
    }
  }

  async function fetchLiveMarkets() {
    const el = document.getElementById("stat-live-markets")!;
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        el.textContent = String(data.events || 0);
      }
    } catch {
      el.textContent = "--";
    }
  }

  function showError(msg: string) {
    errorMsg.textContent = msg;
  }

  function hideError() {
    errorMsg.textContent = "";
  }
});

// ── Helpers ──

function escHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function validateCode(code: string): Promise<{ valid: boolean; reason: string }> {
  const res = await fetch(`${BACKEND_URL}/validate-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return { valid: false, reason: "not_found" };
  return res.json();
}

function chromeGet(key: string): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, resolve);
  });
}

async function getStoredAccess(): Promise<StoredAccess | null> {
  const result = await chromeGet(ACCESS_STORAGE_KEY);
  return result[ACCESS_STORAGE_KEY] ?? null;
}

async function storeAccess(code: string): Promise<void> {
  const data: StoredAccess = { code, validatedAt: Date.now() };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [ACCESS_STORAGE_KEY]: data }, resolve);
  });
}

async function clearAccess(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(ACCESS_STORAGE_KEY, resolve);
  });
}

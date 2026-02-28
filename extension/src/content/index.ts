import { BatchQueue } from "../matching/batch-queue";
import { ApiClient } from "../matching/api-client";
import { startObserving } from "./tweet-observer";
import { ACCESS_STORAGE_KEY, ACCESS_VALIDATION_TTL_MS } from "../config";

let activated = false;

async function checkAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.get(ACCESS_STORAGE_KEY, (result) => {
      const stored = result[ACCESS_STORAGE_KEY];
      if (!stored || !stored.code) {
        resolve(false);
        return;
      }
      const age = Date.now() - (stored.validatedAt || 0);
      resolve(age < ACCESS_VALIDATION_TTL_MS);
    });
  });
}

function activate() {
  if (activated) return;
  activated = true;

  const apiClient = new ApiClient();
  const batchQueue = new BatchQueue(apiClient);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      startObserving(batchQueue);
    });
  } else {
    startObserving(batchQueue);
  }

}

async function init() {
  const hasAccess = await checkAccess();
  if (hasAccess) {
    activate();
  }
}

// Activate immediately when user enters a valid code (no page reload needed)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[ACCESS_STORAGE_KEY]) {
    const newVal = changes[ACCESS_STORAGE_KEY].newValue;
    if (newVal?.code && Date.now() - (newVal.validatedAt || 0) < ACCESS_VALIDATION_TTL_MS) {
      activate();
    }
  }
});

init();

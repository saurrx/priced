import { BatchQueue } from "../matching/batch-queue";
import { ApiClient } from "../matching/api-client";
import { startObserving } from "./tweet-observer";

console.log("[Predict] Extension loading...");

const apiClient = new ApiClient();
const batchQueue = new BatchQueue(apiClient);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    startObserving(batchQueue);
  });
} else {
  startObserving(batchQueue);
}

console.log("[Predict] Extension loaded. Watching for tweets.");

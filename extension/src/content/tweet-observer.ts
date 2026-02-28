import { BatchQueue } from "../matching/batch-queue";
import { MIN_TWEET_LENGTH } from "../config";

const processedTweets = new Set<string>();

export function startObserving(batchQueue: BatchQueue) {
  const existing = document.querySelectorAll('article[data-testid="tweet"]');
  existing.forEach((article) =>
    processTweet(article as HTMLElement, batchQueue)
  );

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.('article[data-testid="tweet"]')) {
          processTweet(node, batchQueue);
        }
        const articles = node.querySelectorAll?.(
          'article[data-testid="tweet"]'
        );
        if (articles) {
          articles.forEach((article) =>
            processTweet(article as HTMLElement, batchQueue)
          );
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log("[Predict] Tweet observer started");
}

function processTweet(article: HTMLElement, batchQueue: BatchQueue) {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl) return;

  const rawText = textEl.textContent || "";
  if (rawText.length < MIN_TWEET_LENGTH) return;

  // Strip URLs — they add noise to semantic matching
  const text = rawText.replace(/https?:\/\/\S+/g, "").replace(/\S+\.\S+\/\S+/g, "").trim();
  if (text.length < MIN_TWEET_LENGTH) return;

  const id = hashText(rawText);
  if (processedTweets.has(id)) return;
  processedTweets.add(id);

  console.log(
    `[Predict] Tweet: "${text.substring(0, 60)}..." → queued for backend`
  );

  // Every tweet goes to the batch queue — no entity matching, no shortcuts
  batchQueue.addTweet(id, text, article);
}

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `t_${hash.toString(36)}`;
}

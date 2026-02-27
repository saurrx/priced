"""Generate event embeddings using bge-base-en-v1.5.

This script is run once to produce the embedding matrix that the backend
server uses for semantic matching. It uses sentence-transformers for
convenience (dev dependency only — production uses ONNX Runtime directly).

Usage:
    python server/scripts/generate_embeddings.py
"""

import json
import os
import sys
import numpy as np

# Resolve paths relative to project root
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_DIR = os.path.dirname(SERVER_DIR)

DESCRIPTIONS_PATH = os.path.join(PROJECT_DIR, "data", "event-descriptions.json")
EMBEDDINGS_PATH = os.path.join(SERVER_DIR, "data", "event-embeddings.npy")
TICKERS_PATH = os.path.join(SERVER_DIR, "data", "event-tickers.json")

def main():
    print("[EMBED] Loading event descriptions...")
    with open(DESCRIPTIONS_PATH) as f:
        data = json.load(f)

    events = data["events"]
    descriptions = [e["enrichedDescription"] for e in events]
    tickers = [e["eventTicker"] for e in events]

    print(f"[EMBED] Loaded {len(descriptions)} event descriptions")

    print("[EMBED] Loading model: BAAI/bge-base-en-v1.5...")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("BAAI/bge-base-en-v1.5")

    print("[EMBED] Encoding descriptions (normalized for cosine similarity)...")
    embeddings = model.encode(
        descriptions,
        normalize_embeddings=True,
        show_progress_bar=True,
        batch_size=64,
    )

    print(f"[EMBED] Generated {embeddings.shape[0]} embeddings of dim {embeddings.shape[1]}")

    # Validate
    norms = np.linalg.norm(embeddings, axis=1)
    print(f"[EMBED] Norm check: min={norms.min():.4f}, max={norms.max():.4f}, mean={norms.mean():.4f}")
    assert abs(norms.mean() - 1.0) < 0.01, "Embeddings not properly normalized"

    # Spot checks
    fed_idx = next((i for i, t in enumerate(tickers) if "FEDCHAIR" in t), None)
    btc_idx = next((i for i, t in enumerate(tickers) if "BTC" in t), None)

    if fed_idx is not None and btc_idx is not None:
        sim = float(embeddings[fed_idx] @ embeddings[btc_idx])
        print(f"[EMBED] Spot check: Fed Chair vs BTC similarity = {sim:.3f} (should be low)")

    # Save
    os.makedirs(os.path.dirname(EMBEDDINGS_PATH), exist_ok=True)
    np.save(EMBEDDINGS_PATH, embeddings)
    with open(TICKERS_PATH, "w") as f:
        json.dump(tickers, f)

    print(f"[EMBED] Saved: {EMBEDDINGS_PATH} ({os.path.getsize(EMBEDDINGS_PATH) / 1024:.0f} KB)")
    print(f"[EMBED] Saved: {TICKERS_PATH}")
    print("[EMBED] Done.")


if __name__ == "__main__":
    main()

"""Generate embeddings for Jupiter market events.

Reads embedding-texts.json and produces event-embeddings.npy
using the same ONNX bge-base-en-v1.5 model.
"""

import json
import os
import numpy as np
from embedder import Embedder

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def main():
    texts_path = os.path.join(DATA_DIR, "embedding-texts.json")
    tickers_path = os.path.join(DATA_DIR, "event-tickers.json")
    output_path = os.path.join(DATA_DIR, "event-embeddings.npy")

    if not os.path.exists(texts_path):
        print("[EMBED] ERROR: embedding-texts.json not found. Run ingest-jupiter.ts first.")
        return

    with open(texts_path) as f:
        texts = json.load(f)

    with open(tickers_path) as f:
        tickers = json.load(f)

    print(f"[EMBED] Generating embeddings for {len(texts)} events...")
    assert len(texts) == len(tickers), f"Mismatch: {len(texts)} texts vs {len(tickers)} tickers"

    embedder = Embedder()

    # Process in batches of 32
    batch_size = 32
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        embeddings = embedder.embed_batch(batch)
        all_embeddings.append(embeddings)
        if (i // batch_size + 1) % 10 == 0:
            print(f"[EMBED]   {i + len(batch)}/{len(texts)} texts processed")

    result = np.vstack(all_embeddings)
    print(f"[EMBED] Embeddings shape: {result.shape}")

    np.save(output_path, result)
    print(f"[EMBED] Saved to {output_path}")
    print(f"[EMBED] Done! {result.shape[0]} events × {result.shape[1]} dims")


if __name__ == "__main__":
    main()

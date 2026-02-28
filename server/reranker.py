"""ONNX-based cross-encoder reranking using gte-reranker-modernbert-base.

Uses ONNX Runtime + HuggingFace tokenizers directly (no torch/transformers).
Downloads the quantized ONNX model from HuggingFace Hub on first init.
"""

import os
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

MODEL_REPO = "Alibaba-NLP/gte-reranker-modernbert-base"
ONNX_FILENAME = "onnx/model_quantized.onnx"


class Reranker:
    def __init__(self):
        model_path = os.path.join(DATA_DIR, "reranker-model.onnx")
        if not os.path.exists(model_path):
            self._download_model(model_path)

        self.session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],
        )
        self.input_names = [inp.name for inp in self.session.get_inputs()]

        self.tokenizer = Tokenizer.from_pretrained(MODEL_REPO)
        self.tokenizer.enable_padding()  # dynamic: pad to longest in batch
        self.tokenizer.enable_truncation(max_length=256)

    def _download_model(self, dest: str):
        """Download quantized ONNX model from HuggingFace Hub."""
        print("[RERANKER] Downloading quantized ONNX model...")
        from huggingface_hub import hf_hub_download

        os.makedirs(os.path.dirname(dest), exist_ok=True)
        downloaded = hf_hub_download(
            MODEL_REPO,
            ONNX_FILENAME,
            local_dir=DATA_DIR,
        )
        if os.path.exists(downloaded) and not os.path.exists(dest):
            os.rename(downloaded, dest)
            onnx_dir = os.path.join(DATA_DIR, "onnx")
            if os.path.isdir(onnx_dir) and not os.listdir(onnx_dir):
                os.rmdir(onnx_dir)
        print("[RERANKER] ONNX model ready.")

    def score_pairs(self, query: str, documents: list[str]) -> np.ndarray:
        """Score (query, document) pairs. Returns sigmoid scores in [0, 1]."""
        if not documents:
            return np.array([], dtype=np.float32)

        pairs = [(query, doc) for doc in documents]
        encoded = self.tokenizer.encode_batch(pairs)

        input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
        attention_mask = np.array(
            [e.attention_mask for e in encoded], dtype=np.int64
        )

        feed = {}
        for name in self.input_names:
            if name == "input_ids":
                feed[name] = input_ids
            elif name == "attention_mask":
                feed[name] = attention_mask

        outputs = self.session.run(None, feed)

        logits = outputs[0].squeeze(-1)  # (batch_size,)
        scores = 1.0 / (1.0 + np.exp(-logits))
        return scores

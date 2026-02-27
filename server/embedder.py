"""ONNX-based embedding inference for bge-base-en-v1.5.

Uses ONNX Runtime + HuggingFace tokenizers directly (not sentence-transformers)
for maximum performance in production. ~400MB smaller than full PyTorch stack.
"""

import os
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


class Embedder:
    def __init__(self):
        model_path = os.path.join(DATA_DIR, "model.onnx")
        if not os.path.exists(model_path):
            self._download_model(model_path)

        self.session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],
        )
        self.tokenizer = Tokenizer.from_pretrained("BAAI/bge-base-en-v1.5")
        self.tokenizer.enable_padding(length=128)
        self.tokenizer.enable_truncation(max_length=128)  # tweets are short

    def _download_model(self, dest: str):
        """Download ONNX model from HuggingFace Hub."""
        print("[EMBEDDER] Downloading ONNX model...")
        from huggingface_hub import hf_hub_download

        os.makedirs(os.path.dirname(dest), exist_ok=True)
        hf_hub_download(
            "BAAI/bge-base-en-v1.5",
            "onnx/model.onnx",
            local_dir=DATA_DIR,
        )
        # The file is downloaded to DATA_DIR/onnx/model.onnx, move it
        downloaded = os.path.join(DATA_DIR, "onnx", "model.onnx")
        if os.path.exists(downloaded) and not os.path.exists(dest):
            os.rename(downloaded, dest)
            # Clean up empty onnx dir
            onnx_dir = os.path.join(DATA_DIR, "onnx")
            if os.path.isdir(onnx_dir) and not os.listdir(onnx_dir):
                os.rmdir(onnx_dir)
        print("[EMBEDDER] ONNX model ready.")

    def embed_batch(self, texts: list[str]) -> np.ndarray:
        """Embed a batch of texts and return normalized embeddings."""
        encoded = self.tokenizer.encode_batch(texts)
        input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
        attention_mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)
        token_type_ids = np.zeros_like(input_ids)

        outputs = self.session.run(
            None,
            {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "token_type_ids": token_type_ids,
            },
        )

        # Mean pooling
        token_embeddings = outputs[0]  # (batch, seq_len, 768)
        mask_expanded = attention_mask[:, :, np.newaxis].astype(np.float32)
        sum_embeddings = np.sum(token_embeddings * mask_expanded, axis=1)
        sum_mask = np.sum(mask_expanded, axis=1)
        embeddings = sum_embeddings / sum_mask

        # L2 normalize
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / norms

        return embeddings

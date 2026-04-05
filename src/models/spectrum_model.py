"""
Spectrum-to-Molecule prediction model.

Encoder-decoder architecture:
  - SpectrumEncoder: MLP that maps binned NMR+MS spectra to a latent vector
  - SelfiesDecoder: GRU that autoregressively generates SELFIES tokens
  - SpectraToMol: end-to-end model combining both

Binning uses Gaussian broadening so that small peak shifts
still produce similar input vectors (critical for real-world robustness).
"""
import json
import math
from typing import List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    import selfies as sf
    SELFIES_AVAILABLE = True
except ImportError:
    SELFIES_AVAILABLE = False

MS_BINS = 2048
NMR_BINS = 1024
MS_RANGE = (0.0, 2000.0)
NMR_RANGE = (-2.0, 14.0)
MAX_SEQ_LEN = 128


class SelfiesVocab:
    """Token vocabulary built from SELFIES representations of SMILES."""

    PAD = "<PAD>"
    SOS = "<SOS>"
    EOS = "<EOS>"

    def __init__(self):
        self.token2idx: dict[str, int] = {self.PAD: 0, self.SOS: 1, self.EOS: 2}
        self.idx2token: dict[int, str] = {0: self.PAD, 1: self.SOS, 2: self.EOS}

    @property
    def size(self) -> int:
        return len(self.token2idx)

    @property
    def pad_idx(self) -> int:
        return 0

    @property
    def sos_idx(self) -> int:
        return 1

    @property
    def eos_idx(self) -> int:
        return 2

    def build_from_smiles(self, smiles_list: List[str]):
        for smiles in smiles_list:
            try:
                selfies_str = sf.encoder(smiles)
            except Exception:
                continue
            if selfies_str is None:
                continue
            for token in sf.split_selfies(selfies_str):
                if token not in self.token2idx:
                    idx = len(self.token2idx)
                    self.token2idx[token] = idx
                    self.idx2token[idx] = token

    def encode(self, selfies_str: str, max_len: int = MAX_SEQ_LEN) -> List[int]:
        tokens = list(sf.split_selfies(selfies_str))
        indices = [self.sos_idx]
        for t in tokens:
            indices.append(self.token2idx.get(t, self.pad_idx))
        indices.append(self.eos_idx)
        if len(indices) < max_len:
            indices.extend([self.pad_idx] * (max_len - len(indices)))
        return indices[:max_len]

    def decode(self, indices: List[int]) -> str:
        tokens = []
        for idx in indices:
            if idx == self.eos_idx:
                break
            if idx in (self.sos_idx, self.pad_idx):
                continue
            token = self.idx2token.get(idx, "")
            if token:
                tokens.append(token)
        return "".join(tokens)

    def save(self, path: str):
        with open(path, "w") as f:
            json.dump({"token2idx": self.token2idx}, f, indent=2)

    @classmethod
    def load(cls, path: str) -> "SelfiesVocab":
        vocab = cls()
        with open(path) as f:
            data = json.load(f)
        vocab.token2idx = data["token2idx"]
        vocab.idx2token = {int(v): k for k, v in vocab.token2idx.items()}
        return vocab


class SpectrumEncoder(nn.Module):
    def __init__(self, input_dim: int = MS_BINS + NMR_BINS,
                 hidden_dim: int = 512, latent_dim: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.LayerNorm(hidden_dim // 2),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim // 2, latent_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class SelfiesDecoder(nn.Module):
    def __init__(self, vocab_size: int, latent_dim: int = 256,
                 embed_dim: int = 128, hidden_dim: int = 256,
                 num_layers: int = 2, dropout: float = 0.1):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.gru = nn.GRU(
            embed_dim, hidden_dim, num_layers=num_layers,
            batch_first=True, dropout=dropout if num_layers > 1 else 0,
        )
        self.fc_out = nn.Linear(hidden_dim, vocab_size)
        self.latent_to_hidden = nn.Linear(latent_dim, hidden_dim * num_layers)

    def _init_hidden(self, latent: torch.Tensor) -> torch.Tensor:
        hidden = self.latent_to_hidden(latent)
        hidden = hidden.view(-1, self.num_layers, self.hidden_dim)
        return hidden.permute(1, 0, 2).contiguous()

    def forward(self, latent: torch.Tensor, target_seq: torch.Tensor) -> torch.Tensor:
        hidden = self._init_hidden(latent)
        embedded = self.embedding(target_seq[:, :-1])
        output, _ = self.gru(embedded, hidden)
        return self.fc_out(output)

    def generate(self, latent: torch.Tensor, sos_idx: int, eos_idx: int,
                 max_len: int = MAX_SEQ_LEN,
                 temperature: float = 1.0) -> Tuple[List[int], float, float]:
        hidden = self._init_hidden(latent)
        input_token = torch.tensor([[sos_idx]], device=latent.device)

        generated: List[int] = []
        total_log_prob = 0.0
        total_entropy = 0.0

        for _ in range(max_len):
            embedded = self.embedding(input_token)
            output, hidden = self.gru(embedded, hidden)
            logits = self.fc_out(output.squeeze(1))
            scaled_logits = logits / temperature
            probs = F.softmax(scaled_logits, dim=-1)
            token_idx = torch.argmax(probs, dim=-1).item()
            total_log_prob += math.log(max(probs[0, token_idx].item(), 1e-10))

            entropy = -(probs * torch.log(probs + 1e-10)).sum().item()
            total_entropy += entropy

            if token_idx == eos_idx:
                break

            generated.append(token_idx)
            input_token = torch.tensor([[token_idx]], device=latent.device)

        n_tokens = max(len(generated), 1)
        avg_log_prob = total_log_prob / n_tokens
        avg_entropy = total_entropy / n_tokens
        confidence = math.exp(avg_log_prob)
        return generated, confidence, avg_entropy


class SpectraToMol(nn.Module):
    """End-to-end spectrum -> molecule model."""

    def __init__(self, vocab_size: int, latent_dim: int = 256,
                 encoder_hidden: int = 512, embed_dim: int = 128,
                 decoder_hidden: int = 256, num_layers: int = 2,
                 dropout: float = 0.1):
        super().__init__()
        self.encoder = SpectrumEncoder(
            input_dim=MS_BINS + NMR_BINS,
            hidden_dim=encoder_hidden,
            latent_dim=latent_dim,
        )
        self.decoder = SelfiesDecoder(
            vocab_size=vocab_size,
            latent_dim=latent_dim,
            embed_dim=embed_dim,
            hidden_dim=decoder_hidden,
            num_layers=num_layers,
            dropout=dropout,
        )

    def forward(self, spectrum: torch.Tensor, target_seq: torch.Tensor) -> torch.Tensor:
        latent = self.encoder(spectrum)
        return self.decoder(latent, target_seq)

    def predict(self, spectrum: torch.Tensor, vocab: SelfiesVocab,
                max_len: int = MAX_SEQ_LEN,
                temperature: float = 1.0) -> Tuple[str, float, float]:
        self.eval()
        with torch.no_grad():
            latent = self.encoder(spectrum.unsqueeze(0) if spectrum.dim() == 1 else spectrum)
            indices, confidence, avg_entropy = self.decoder.generate(
                latent, vocab.sos_idx, vocab.eos_idx, max_len, temperature,
            )
        selfies_str = vocab.decode(indices)
        return selfies_str, confidence, avg_entropy


def bin_peaks(peaks: List[Tuple[float, float]], lo: float, hi: float,
              n_bins: int, sigma_bins: float = 3.0) -> np.ndarray:
    """Bin spectral peaks with Gaussian broadening for robustness.

    Each peak is spread across neighboring bins using a Gaussian kernel,
    so small shifts in peak position still produce similar vectors.
    sigma_bins controls the width in bin-units (default 3.0 ~ 3 Da for MS).
    """
    vec = np.zeros(n_bins, dtype=np.float32)
    bin_width = (hi - lo) / n_bins

    for x, y in peaks:
        if lo <= x < hi:
            center = (x - lo) / bin_width
            radius = int(sigma_bins * 3) + 1
            lo_idx = max(0, int(center) - radius)
            hi_idx = min(n_bins, int(center) + radius + 1)
            for i in range(lo_idx, hi_idx):
                dist = (i - center) / sigma_bins
                weight = y * math.exp(-0.5 * dist * dist)
                vec[i] = max(vec[i], weight)

    norm = vec.max()
    if norm > 0:
        vec /= norm
    return vec


MS_SIGMA_BINS = 3.0
NMR_SIGMA_BINS = 3.0


def build_spectrum_vector(
    ms_peaks: Optional[List[Tuple[float, float]]] = None,
    nmr_peaks: Optional[List[Tuple[float, float]]] = None,
) -> np.ndarray:
    ms_vec = (bin_peaks(ms_peaks, *MS_RANGE, MS_BINS, MS_SIGMA_BINS)
              if ms_peaks else np.zeros(MS_BINS, dtype=np.float32))
    nmr_vec = (bin_peaks(nmr_peaks, *NMR_RANGE, NMR_BINS, NMR_SIGMA_BINS)
               if nmr_peaks else np.zeros(NMR_BINS, dtype=np.float32))
    return np.concatenate([ms_vec, nmr_vec])

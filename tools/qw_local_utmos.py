#!/usr/bin/env python3
"""Score local audio files with UTMOS, a naturalness MOS predictor.

Why this exists
---------------
The quality gate used to judge naturalness by asking a multimodal model for a
1-10 score. That is the weakest part of the gate: on the same clip the score
moves between runs, and low-quality samples tend to be rated generously. UTMOS
is a trained MOS predictor (VoiceMOS Challenge 2022), so it gives a number that
is at least reproducible, and it is an independent signal rather than another
question to the same kind of model.

It is advisory, not a gate. A predicted MOS is not a listening test: it is
known to compress toward the middle of its range and to generalise poorly to
unseen systems, so it is reported alongside the other measurements rather than
deciding on its own.

Setup
-----
Needs PyTorch, which the rest of the toolchain does not:

    pip install utmos-pytorch

Weights download on first use. Nothing here is needed to *use* the plugin; only
to regenerate or re-check the audio.

Usage
-----
    python qw_local_utmos.py <audio> [<audio> ...] [--json]

Prints one line per file and a JSON array. Exits non-zero when it cannot run,
which the caller treats as "not available" rather than as a failure of the audio.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

SAMPLE_RATE = 16_000  # what UTMOS was trained on


def main() -> int:
    parser = argparse.ArgumentParser(description="Score audio files with UTMOS.")
    parser.add_argument("files", nargs="+", help="audio files to score")
    parser.add_argument("--json", action="store_true", help="print only the JSON array")
    args = parser.parse_args()

    try:
        import librosa  # noqa: PLC0415  (import cost is why this is deferred)
        import numpy as np  # noqa: PLC0415
        import torch  # noqa: PLC0415
        from utmos_pytorch import UTMOSScoreTorch  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001 - any import problem means "unavailable"
        print(f"[utmos] unavailable: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("[utmos] install it with: pip install utmos-pytorch", file=sys.stderr)
        return 2

    model = UTMOSScoreTorch(device="cpu")
    results = []
    for name in args.files:
        path = pathlib.Path(name)
        if not path.is_file():
            print(f"[utmos] missing: {name}", file=sys.stderr)
            return 1
        try:
            audio, _ = librosa.load(str(path), sr=SAMPLE_RATE, mono=True)
            # The predictor expects a torch tensor, and the audio has to be finite.
            wave = torch.from_numpy(np.asarray(audio, dtype="float32"))
            score = float(model.score(wave))
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"[utmos] failed on {path.name}: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1
        results.append({"file": str(path), "name": path.name, "utmos": round(score, 3)})
        if not args.json:
            print(f"  {path.name:<26} UTMOS {score:.3f}")

    if args.json:
        print(json.dumps(results, ensure_ascii=False))
    else:
        scores = [r["utmos"] for r in results]
        if scores:
            print(f"\n  mean {sum(scores) / len(scores):.3f}  "
                  f"min {min(scores):.3f}  max {max(scores):.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

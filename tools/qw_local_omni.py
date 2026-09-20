#!/usr/bin/env python3
"""Send a local audio file to a multimodal model (Qwen-Omni) and print its answer.

Why this exists rather than a plain CLI call
--------------------------------------------
The Bailian CLI's `--audio <local path>` goes through a file-upload step whose
upload policy endpoint is not region-aware, so it fails with a confusing auth
error for some credentials. The official API also accepts the audio inline as a
base64 data URL, which avoids the upload entirely: nothing is staged remotely, no
temporary URL is issued, and no extra request header is needed.

This script uses that inline path. It reads the credential from the CLI's own
config file, so anything already authenticated there works unchanged.

Usage
-----
    python qw_local_omni.py <audio file> --message "your question" \\
        [--model qwen3.5-omni-plus] [--profile <name>] [--max-tokens 1024] [--json]

Several files may be given at once, which is what makes it useful for comparing
candidate recordings against each other.

Typical use here: reviewing synthesized alert clips for clarity, naturalness,
voice character and cleanliness.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import pathlib
import sys
import urllib.error
import urllib.request

DEFAULT_MODEL = "qwen3.5-omni-plus"
DEFAULT_BASE = "https://dashscope-intl.aliyuncs.com"
CONFIG = pathlib.Path.home() / ".bailian" / "config.json"
MAX_B64_BYTES = 10 * 1024 * 1024  # documented ceiling: 10 MB once base64-encoded


def load_profile(profile: str | None) -> tuple[str, str]:
    """Read the key and base_url for the named (or active) profile from the CLI config."""
    if CONFIG.is_file():
        try:
            data = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        name = profile or data.get("active_config")
        section = data.get(name) if isinstance(data.get(name), dict) else None
        if section and section.get("api_key"):
            return str(section["api_key"]).strip(), str(section.get("base_url") or DEFAULT_BASE).rstrip("/")
    raise SystemExit(f"no api_key for profile {profile or '(active)'} in {CONFIG}; authenticate the CLI first.")


def mask(key: str) -> str:
    return "***" if len(key) < 9 else f"{key[:4]}...{key[-4:]}"


def call_omni(base: str, key: str, model: str, audio_parts: list[dict],
              message: str, max_tokens: int | None, timeout: int = 300) -> dict:
    """OpenAI-compatible chat/completions with input_audio as a Data URL; accepts several clips."""
    content: list[dict] = [{"type": "text", "text": message}]
    content.extend(audio_parts)
    payload: dict = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "modalities": ["text"],
        "stream": False,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens
    req = urllib.request.Request(
        f"{base}/compatible-mode/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"model call HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:500]}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"model call network failure: {exc.reason}") from exc


def extract_text(data: dict) -> str:
    """Accept both native and compatible response shapes."""
    choices = (data.get("output") or {}).get("choices") or data.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message", {}) or {}
    content = msg.get("content", "")
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict)).strip()
    return str(content).strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Understand a local audio file with a multimodal model, audio inlined as base64.")
    ap.add_argument("audio", nargs="+", help="one or more audio files; several are sent together in the order given")
    ap.add_argument("--message", required=True, help="the question or review prompt for the model")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--profile", default=None)
    ap.add_argument("--max-tokens", type=int, default=None)
    ap.add_argument("--json", action="store_true", help="print the full response as JSON")
    args = ap.parse_args(argv)

    key, base = load_profile(args.profile)

    parts: list[dict] = []
    for name in args.audio:
        src = pathlib.Path(name)
        if not src.is_file():
            raise SystemExit(f"no such file: {src}")
        raw = src.read_bytes()
        b64_len = (len(raw) + 2) // 3 * 4
        if b64_len > MAX_B64_BYTES:
            raise SystemExit(f"{src.name} is {b64_len:,}B once base64-encoded, above the {MAX_B64_BYTES:,}B limit; use a smaller file.")
        mime = mimetypes.guess_type(src.name)[0] or "audio/mpeg"
        fmt = (src.suffix.lstrip(".") or "mp3").lower()
        parts.append({
            "type": "input_audio",
            "input_audio": {
                "data": f"data:{mime};base64," + base64.b64encode(raw).decode("ascii"),
                "format": fmt,
            },
        })
        print(f"[omni] {src.name} {len(raw):,}B format={fmt}", file=sys.stderr)

    print(f"[omni] {base} | credential {mask(key)} | model={args.model} | {len(parts)} clip(s)", file=sys.stderr)

    resp = call_omni(base, key, args.model, parts, args.message, args.max_tokens)
    if args.json:
        print(json.dumps(resp, ensure_ascii=False, indent=2))
    else:
        print(extract_text(resp))
    return 0


if __name__ == "__main__":
    sys.exit(main())
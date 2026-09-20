#!/usr/bin/env python3
"""Transcribe a local audio file with the official API, picking a transport automatically.

Why this exists rather than a plain CLI call
--------------------------------------------
A CLI that takes a local audio path often stages the file through an upload step
whose policy endpoint is not region-aware, which surfaces as a confusing auth
error for some credentials. The official API offers two paths that both work
regardless of region, and this script implements both:

* ``base64`` (the default, for audio up to ~10 MB) -- the documented
  ``input_audio.data`` form, i.e. a ``data:;base64,...`` URL. Nothing is uploaded,
  no temporary URL is created, and no extra request header is required.
* ``upload`` (for larger files) -- the documented three-step flow:
  (1) ``GET /api/v1/uploads?action=getPolicy&model=<model>``
  (2) ``POST {upload_host}`` as multipart, with ``file`` as the last form field
  (3) build ``oss://{upload_dir}/{filename}`` and call the model with the
      ``X-DashScope-OssResourceResolve: enable`` header, which that reference
      requires.

The credential is read from the CLI's own config file, so anything already
authenticated there works unchanged.

Usage
-----
    python qw_local_asr.py <audio file> [--lang zh] [--itn] [--model qwen3-asr-flash]
                           [--profile <name>] [--strategy auto|base64|upload] [--json]
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

DEFAULT_MODEL = "qwen3-asr-flash"
DEFAULT_BASE = "https://dashscope-intl.aliyuncs.com"
CONFIG = pathlib.Path.home() / ".bailian" / "config.json"
MAX_B64_BYTES = 10 * 1024 * 1024      # documented ceiling: 10 MB once base64-encoded
OSS_RESOLVE_HEADER = "X-DashScope-OssResourceResolve"  # required for an oss:// reference


def load_profile(profile: str | None) -> tuple[str, str]:
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


# ── documented three-step upload ──────────────────────────────────────────
def get_policy(base: str, key: str, model: str, timeout: int = 60) -> dict:
    url = f"{base}/api/v1/uploads?action=getPolicy&model={urllib.parse.quote(model)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8")).get("data", {})
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"getPolicy HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"getPolicy network failure: {exc.reason}") from exc


def post_to_oss(policy: dict, src: pathlib.Path, timeout: int = 600) -> str:
    host = str(policy["upload_host"]).rstrip("/")
    obj = f"{str(policy['upload_dir']).rstrip('/')}/{src.name}"
    fields = {
        "key": obj,
        "policy": policy["policy"],
        "OSSAccessKeyId": policy["oss_access_key_id"],
        "signature": policy["signature"],
        "success_action_status": "200",
        # These two are pinned by the policy and must be echoed back, or OSS answers 403 Policy Condition failed
        "x-oss-object-acl": policy.get("x_oss_object_acl", "private"),
        "x-oss-forbid-overwrite": policy.get("x_oss_forbid_overwrite", "true"),
    }
    mime = mimetypes.guess_type(src.name)[0] or "application/octet-stream"
    b = "----qw" + uuid.uuid4().hex
    parts = [
        f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8")
        for k, v in fields.items()
    ]
    parts.append(
        (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{src.name}"\r\n'
         f"Content-Type: {mime}\r\n\r\n").encode("utf-8")
    )
    parts.append(src.read_bytes())
    parts.append(f"\r\n--{b}--\r\n".encode("utf-8"))
    req = urllib.request.Request(
        host, data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={b}"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status not in (200, 201, 204):
                raise SystemExit(f"unexpected OSS upload status HTTP {r.status}")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"OSS upload HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"OSS upload network failure: {exc.reason}") from exc
    # Note: the documented form is `return f"oss://{key}"` -- the URL carries NO bucket name.
    # Building oss://{bucket}/{key} instead makes the model reject it with
    # `<400> InternalError.Algo.InvalidParameter: The provided URL does not appear to be valid`.
    return f"oss://{obj}"


def call_native(base: str, key: str, model: str, audio_ref: str, is_oss: bool,
                lang: str | None, itn: bool, timeout: int = 300) -> dict:
    """Native API call; an oss:// reference requires the resolve header."""
    content = [{"audio": audio_ref}]
    payload = {
        "model": model,
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": {"asr_options": {"enable_itn": itn}},
    }
    if lang:
        payload["parameters"]["asr_options"]["language"] = lang
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if is_oss:
        headers[OSS_RESOLVE_HEADER] = "enable"
    req = urllib.request.Request(
        f"{base}/api/v1/services/aigc/multimodal-generation/generation",
        data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"model call HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:400]}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"model call network failure: {exc.reason}") from exc


def call_compatible(base: str, key: str, model: str, data_url: str, lang: str | None,
                    itn: bool, timeout: int = 300) -> dict:
    """OpenAI-compatible base64 path (the docs support input_audio.data as a Data URL)."""
    opts = {"enable_itn": itn}
    if lang:
        opts["language"] = lang
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "input_audio", "input_audio": {"data": data_url}}
        ]}],
        "stream": False,
        "asr_options": opts,
    }
    req = urllib.request.Request(
        f"{base}/compatible-mode/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"model call HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:400]}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"model call network failure: {exc.reason}") from exc


def extract_text(data: dict) -> str:
    """Accept both response shapes: native output.choices and compatible choices."""
    choices = (data.get("output") or {}).get("choices") or data.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message", {}) or {}
    content = msg.get("content", "")
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict)).strip()
    return str(content).strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Transcribe a local audio file, choosing the transport automatically.")
    ap.add_argument("audio")
    ap.add_argument("--lang", default=None, help="language hint (zh/en/yue/...; omit for mixed speech)")
    ap.add_argument("--itn", action="store_true", help="inverse text normalisation (numbers become digits)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--profile", default=None)
    ap.add_argument("--strategy", choices=("auto", "base64", "upload"), default="auto")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    src = pathlib.Path(args.audio)
    if not src.is_file():
        raise SystemExit(f"no such file: {src}")
    key, base = load_profile(args.profile)
    raw = src.read_bytes()
    b64_len = (len(raw) + 2) // 3 * 4

    strategy = args.strategy
    if strategy == "auto":
        strategy = "base64" if b64_len <= MAX_B64_BYTES else "upload"

    print(f"[asr] {base} | credential {mask(key)} | {src.name} {len(raw):,}B | transport={strategy}", file=sys.stderr)

    if strategy == "base64":
        mime = mimetypes.guess_type(src.name)[0] or "audio/mpeg"
        data_url = f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")
        resp = call_compatible(base, key, args.model, data_url, args.lang, args.itn)
    else:
        policy = get_policy(base, key, args.model)
        host = str(policy.get("upload_host", ""))
        print(f"[asr] uploading to {host}", file=sys.stderr)
        oss_url = post_to_oss(policy, src)
        print(f"[asr] uploaded -> {oss_url}", file=sys.stderr)
        resp = call_native(base, key, args.model, oss_url, True, args.lang, args.itn)

    if args.json:
        print(json.dumps(resp, ensure_ascii=False, indent=2))
    else:
        print(extract_text(resp))
    return 0


if __name__ == "__main__":
    sys.exit(main())
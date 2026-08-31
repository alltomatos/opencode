#!/usr/bin/env python3
"""Local relay that re-issues OpenCode's Anthropic-shaped requests through the
synchronous `anthropic` Python SDK, which is the only HTTP client shape that
passes AgentRouter's (agentrouter.org) connection-fingerprint WAF check.

Generic clients (Node fetch/undici, curl, async httpx) get rejected with
`unauthorized client detected` regardless of a valid API key. This is a
stdlib-only HTTP server (no FastAPI/uvicorn) so the only extra dependency
opencode needs to manage is the `anthropic` package itself.

Env vars:
  AGENTROUTER_API_KEY  required, the user's AgentRouter API key
  AGENTROUTER_PORT     optional, default 7187
  AGENTROUTER_UPSTREAM optional, default https://agentrouter.org
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import anthropic

API_KEY = os.environ.get("AGENTROUTER_API_KEY")
PORT = int(os.environ.get("AGENTROUTER_PORT", "7187"))
UPSTREAM = os.environ.get("AGENTROUTER_UPSTREAM", "https://agentrouter.org")

if not API_KEY:
    print("AGENTROUTER_API_KEY is required", file=sys.stderr)
    sys.exit(1)

client = anthropic.Anthropic(api_key=API_KEY, base_url=UPSTREAM)

# Static stub — the real /v1/models on AgentRouter is also blocked by the WAF.
# Mirrors the model list from the AgentRouter console at time of writing.
STUB_MODELS = [
    {"id": "claude-opus-4-8", "name": "claude-opus-4-8"},
    {"id": "claude-opus-5", "name": "claude-opus-5"},
    {"id": "deepseek-v4-flash", "name": "deepseek-v4-flash"},
    {"id": "glm-5.3", "name": "glm-5.3"},
    {"id": "gpt-5.6-sol", "name": "gpt-5.6-sol"},
]

# Top-level fields AgentRouter's content filter rejects outright.
STRIP_KEYS = ("thinking", "output_config")

# Multi-turn conversations with a reasoning-capable model (e.g. claude-opus)
# put a "thinking" (and, for redacted reasoning, "redacted_thinking") block
# in the assistant's prior message content array, sent back verbatim as
# context on the next turn. Stripping only the top-level `thinking` request
# param (STRIP_KEYS above) never touched this. Strip it defensively — it's
# a real difference between turn 1 and turn 2 payloads, and the analogous
# top-level field is already known to trip AgentRouter's filter.
STRIP_BLOCK_TYPES = ("thinking", "redacted_thinking")

# SSE event types AgentRouter injects that OpenCode's Zod-based stream parser
# doesn't recognize and rejects the whole stream over.
DROP_SSE_EVENTS = {"billing_summary"}

# Confirmed 2026-08-31 by isolating with curl directly against this relay,
# across all 5 models, with a fresh never-used API key: a deterministic
# "content-blocked" 400 is AgentRouter's own content filter flagging
# non-English (specifically Portuguese) message text — reproduced with
# trivial, benign prompts ("analise o codigo") on turn 1, single message, no
# tools. Not caused by thinking blocks, cache_control, payload size, key
# throttling, or a specific model — those were all ruled out first. This is
# on AgentRouter's side, and it doesn't matter which model or key is used, or
# whether the text is benign. There's no way to fix this from our side beyond
# routing text through machine translation before it leaves this relay:
# translate every plain-text message block (both the user's own
# messages and any assistant text already in the conversation history, since
# a prior PT-BR reply gets echoed back as context on the next turn and trips
# the filter just as much as new PT-BR input does) to English via Google's
# free/keyless translate endpoint, and tell the model via the system prompt
# to keep answering in Portuguese despite the translated-to-English input.
# Best-effort: if the translate call fails for any reason (network, rate
# limit, endpoint shape change), fall back to sending the original text
# un-translated rather than failing the whole request — a PT-BR block is a
# known, recoverable-by-retry failure mode; don't trade it for an unrelated
# hard failure.
TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single"

PT_REPLY_INSTRUCTION = (
    "\n\nIMPORTANT: The user's messages below were machine-translated from "
    "Brazilian Portuguese (pt-BR) into English before reaching you, solely to "
    "pass an upstream content filter that blocks non-English text. Always "
    "reply to the user in Brazilian Portuguese (pt-BR) — never in English —"
    " matching the language they actually wrote in."
)


# Full conversation history is resent on every turn, so without caching the
# same already-translated message text would be re-translated (and re-fetch
# the network) on every single turn of a growing conversation. Unbounded is
# fine here: this process is a short-lived per-session relay, not a shared
# long-running server, so there's no realistic growth concern within one run.
_TRANSLATE_CACHE = {}

# Each translate call is a real network round-trip (~0.8-1.5s measured
# against the live endpoint). A growing conversation resends its whole
# history every turn, so translating blocks one at a time serially — as the
# first version of this did — stacks that latency linearly (10 uncached
# blocks ≈ 10-15s before the response even starts streaming), long enough to
# trip OpenCode's own request timeout and abort the turn with pending tool
# calls still in flight (observed 2026-08-31: real conversations looping,
# re-planning from scratch after "Tool execution aborted"). warm_translate
# fetches every not-yet-cached text concurrently first so the total added
# latency is roughly the slowest single call, not the sum of all of them.
_TRANSLATE_POOL = ThreadPoolExecutor(max_workers=8)


def _fetch_translation(text):
    try:
        params = urllib.parse.urlencode({"client": "gtx", "sl": "auto", "tl": "en", "dt": "t", "q": text})
        req = urllib.request.Request(
            f"{TRANSLATE_ENDPOINT}?{params}",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return "".join(chunk[0] for chunk in data[0] if chunk[0])
    except Exception:
        return text


def warm_translate(texts):
    pending = list(dict.fromkeys(t for t in texts if t and t.strip() and t not in _TRANSLATE_CACHE))
    if not pending:
        return
    for text, translated in zip(pending, _TRANSLATE_POOL.map(_fetch_translation, pending)):
        _TRANSLATE_CACHE[text] = translated


def translate_to_english(text):
    if not text or not text.strip():
        return text
    if text not in _TRANSLATE_CACHE:
        _TRANSLATE_CACHE[text] = _fetch_translation(text)
    return _TRANSLATE_CACHE[text]


def strip_cache_control(block):
    if "cache_control" not in block:
        return block
    return {k: v for k, v in block.items() if k != "cache_control"}


def translate_block(block):
    if block.get("type") == "text" and isinstance(block.get("text"), str):
        return {**block, "text": translate_to_english(block["text"])}
    return block


def message_texts(messages):
    texts = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            for block in content:
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    texts.append(block["text"])
        elif isinstance(content, str):
            texts.append(content)
    return texts


def clean_messages(messages):
    warm_translate(message_texts(messages))
    cleaned = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            content = [
                translate_block(strip_cache_control(block))
                for block in content
                if block.get("type") not in STRIP_BLOCK_TYPES
            ]
            message = {**message, "content": content}
        elif isinstance(content, str):
            message = {**message, "content": translate_to_english(content)}
        cleaned.append(message)
    return cleaned


def append_pt_instruction(system):
    if isinstance(system, str):
        return system + PT_REPLY_INSTRUCTION
    if isinstance(system, list):
        return [*system, {"type": "text", "text": PT_REPLY_INSTRUCTION.strip()}]
    return [{"type": "text", "text": PT_REPLY_INSTRUCTION.strip()}]


def clean_payload(payload):
    payload = {k: v for k, v in payload.items() if k not in STRIP_KEYS}
    if isinstance(payload.get("messages"), list):
        payload["messages"] = clean_messages(payload["messages"])
    if isinstance(payload.get("system"), list):
        payload["system"] = [strip_cache_control(block) for block in payload["system"]]
    payload["system"] = append_pt_instruction(payload.get("system"))
    return payload


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True})
            return
        if self.path in ("/v1/models", "/models"):
            self._send_json(200, {"data": STUB_MODELS})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/v1/messages", "/messages"):
            self._send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = clean_payload(json.loads(raw))
        except json.JSONDecodeError as e:
            self._send_json(400, {"error": f"invalid json: {e}"})
            return

        if payload.get("stream"):
            self._handle_stream(payload)
        else:
            self._handle_sync(payload)

    def _handle_sync(self, payload):
        payload = {**payload, "stream": False}
        try:
            result = client.messages.create(**payload)
        except anthropic.APIStatusError as e:
            self._send_json(e.status_code, e.body if isinstance(e.body, dict) else {"error": str(e)})
            return
        except Exception as e:
            self._send_json(502, {"type": "error", "error": {"type": "api_error", "message": str(e)}})
            return
        self._send_json(200, result.model_dump(exclude_none=True))

    def _handle_stream(self, payload):
        # Deliberately use the low-level create(stream=True) call, not the
        # messages.stream() convenience helper: the helper (a) rejects some
        # normal params (observed: TypeError on `temperature` for non-Claude
        # models bridged through AgentRouter) and (b) synthesizes extra
        # SDK-only event shapes (e.g. a `type: "text"` snapshot event) on top
        # of the real wire protocol, which OpenCode's Anthropic stream parser
        # doesn't recognize and rejects the whole stream over. create()'s
        # stream yields exactly the documented Anthropic SSE event types.
        payload = {**payload, "stream": True}
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("connection", "close")
        self.end_headers()
        self.close_connection = True

        try:
            stream = client.messages.create(**payload)
            for event in stream:
                event_type = getattr(event, "type", None)
                if event_type in DROP_SSE_EVENTS:
                    continue
                # AgentRouter sends fields the Anthropic SDK types as optional
                # objects (e.g. content_block.caller on tool_use blocks) with
                # an explicit `null` instead of omitting them. OpenCode's Zod
                # stream parser has no branch for "object field is null" (only
                # "object" or "absent"), so it rejects the whole event with an
                # invalid_union error. exclude_none drops those keys entirely
                # instead of serializing them as null, which validates fine.
                data = json.dumps(event.model_dump(exclude_none=True))
                chunk = f"event: {event_type}\ndata: {data}\n\n".encode("utf-8")
                try:
                    self.wfile.write(chunk)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return
        except Exception as e:
            try:
                err = json.dumps({"type": "error", "error": {"type": "api_error", "message": str(e)}})
                self.wfile.write(f"event: error\ndata: {err}\n\n".encode("utf-8"))
            except (BrokenPipeError, ConnectionResetError):
                pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"AgentRouter relay -> {UPSTREAM}")
    print(f"Listening on http://127.0.0.1:{PORT}")
    sys.stdout.flush()
    server.serve_forever()


if __name__ == "__main__":
    main()

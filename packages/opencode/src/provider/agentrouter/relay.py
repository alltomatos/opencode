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
# top-level field is already known to trip AgentRouter's filter — but it
# alone did NOT reproduce/fix a specific "content-blocked" 400 seen in
# testing (2026-08-31): a deterministic block on turn 2+ of a real
# multi-turn conversation, reproduced consistently across retries, that
# persisted even with this stripping AND with cache_control also stripped
# (see strip_cache_control below). Root cause for that specific case is
# still unconfirmed — most likely a per-key throttle/abuse flag on
# AgentRouter's side from heavy testing, not a payload content issue.
STRIP_BLOCK_TYPES = ("thinking", "redacted_thinking")

# SSE event types AgentRouter injects that OpenCode's Zod-based stream parser
# doesn't recognize and rejects the whole stream over.
DROP_SSE_EVENTS = {"billing_summary"}


def strip_cache_control(block):
    if "cache_control" not in block:
        return block
    return {k: v for k, v in block.items() if k != "cache_control"}


def clean_messages(messages):
    cleaned = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            content = [strip_cache_control(block) for block in content if block.get("type") not in STRIP_BLOCK_TYPES]
            message = {**message, "content": content}
        cleaned.append(message)
    return cleaned


def clean_payload(payload):
    payload = {k: v for k, v in payload.items() if k not in STRIP_KEYS}
    if isinstance(payload.get("messages"), list):
        payload["messages"] = clean_messages(payload["messages"])
    if isinstance(payload.get("system"), list):
        payload["system"] = [strip_cache_control(block) for block in payload["system"]]
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
        self._send_json(200, result.model_dump())

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
                data = event.model_dump_json()
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

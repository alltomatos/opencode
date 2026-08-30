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

# Fields AgentRouter's content filter rejects outright.
STRIP_KEYS = ("thinking", "output_config")

# SSE event types AgentRouter injects that OpenCode's Zod-based stream parser
# doesn't recognize and rejects the whole stream over.
DROP_SSE_EVENTS = {"billing_summary"}


def clean_payload(payload):
    return {k: v for k, v in payload.items() if k not in STRIP_KEYS}


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
            self._send_json(502, {"error": str(e)})
            return
        self._send_json(200, result.model_dump())

    def _handle_stream(self, payload):
        payload = {k: v for k, v in payload.items() if k != "stream"}
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("connection", "close")
        self.end_headers()
        self.close_connection = True

        try:
            with client.messages.stream(**payload) as stream:
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
                err = json.dumps({"type": "error", "error": {"message": str(e)}})
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

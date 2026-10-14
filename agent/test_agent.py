"""Tests for the monitoring agent's Ollama collection. Run: python -m unittest agent/test_agent.py"""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm_manager_agent as agent  # noqa: E402

PS_RESPONSE = {
    "models": [
        {
            "name": "llama3:8b",
            "model": "llama3:8b",
            "size": 6_000_000_000,
            "size_vram": 5_500_000_000,
            "expires_at": "2026-10-14T12:00:00Z",
            "details": {"parameter_size": "8.0B", "quantization_level": "Q4_0", "family": "llama"},
        },
        {"name": "tiny", "size": 100, "size_vram": 0, "details": {}},
    ]
}


def stop(server):
    server.shutdown()
    server.server_close()


def serve(routes):
    """routes: path -> (status, body). Returns (server, base_url)."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status, body = routes.get(self.path, (404, {}))
            payload = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}"


class OllamaCollection(unittest.TestCase):
    def test_not_configured_reports_everything_unavailable(self):
        self.assertEqual(agent.collect_ollama(""), {"ollama_up": None, "ollama_version": None, "ollama_models": None})

    def test_running_with_loaded_models(self):
        server, url = serve({"/api/version": (200, {"version": "0.12.3"}), "/api/ps": (200, PS_RESPONSE)})
        self.addCleanup(stop, server)
        out = agent.collect_ollama(url)
        self.assertIs(out["ollama_up"], True)
        self.assertEqual(out["ollama_version"], "0.12.3")
        self.assertEqual(len(out["ollama_models"]), 2)
        first = out["ollama_models"][0]
        self.assertEqual(first["name"], "llama3:8b")
        self.assertEqual(first["size_bytes"], 6_000_000_000)
        self.assertEqual(first["size_vram_bytes"], 5_500_000_000)
        self.assertEqual(first["parameter_size"], "8.0B")
        self.assertEqual(first["quantization"], "Q4_0")
        self.assertEqual(out["ollama_models"][1]["size_vram_bytes"], 0)  # a real zero is kept
        self.assertIsNone(out["ollama_models"][1]["parameter_size"])  # missing is None

    def test_running_with_nothing_loaded_is_an_empty_list_not_none(self):
        server, url = serve({"/api/version": (200, {"version": "0.12.3"}), "/api/ps": (200, {"models": []})})
        self.addCleanup(stop, server)
        out = agent.collect_ollama(url)
        self.assertIs(out["ollama_up"], True)
        self.assertEqual(out["ollama_models"], [])

    def test_unreachable_is_down(self):
        out = agent.collect_ollama("http://127.0.0.1:1")
        self.assertEqual(out, {"ollama_up": False, "ollama_version": None, "ollama_models": None})

    def test_bad_version_response_is_down(self):
        server, url = serve({"/api/version": (500, {})})
        self.addCleanup(stop, server)
        self.assertIs(agent.collect_ollama(url)["ollama_up"], False)

    def test_model_list_failure_keeps_up_but_models_unavailable(self):
        server, url = serve({"/api/version": (200, {"version": "0.12.3"}), "/api/ps": (200, b"not json")})
        self.addCleanup(stop, server)
        out = agent.collect_ollama(url)
        self.assertIs(out["ollama_up"], True)
        self.assertIsNone(out["ollama_models"])

    def test_limits_and_sanitises(self):
        many = {"models": [{"name": "m" * 500, "size": -5, "size_vram": "big", "details": {}}] * 30}
        server, url = serve({"/api/version": (200, {"version": "v" * 100}), "/api/ps": (200, many)})
        self.addCleanup(stop, server)
        out = agent.collect_ollama(url + "/")  # trailing slash tolerated
        self.assertEqual(len(out["ollama_models"]), 20)
        self.assertEqual(len(out["ollama_models"][0]["name"]), 100)
        self.assertEqual(len(out["ollama_version"]), 32)
        self.assertIsNone(out["ollama_models"][0]["size_bytes"])
        self.assertIsNone(out["ollama_models"][0]["size_vram_bytes"])


class CollectIncludesOllama(unittest.TestCase):
    def test_default_collect_has_null_ollama_fields(self):
        m = agent.collect(agent.NetworkRate(), "/")
        self.assertIsNone(m["ollama_up"])
        self.assertIsNone(m["ollama_models"])


if __name__ == "__main__":
    unittest.main()

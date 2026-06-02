"""End-to-end batching test for the Python SDK.

Spins up a local HTTP server, points the SDK at it, fires 23 track() calls,
and asserts they arrive as 2 batched POSTs (20 via size trigger, 3 via timer)
— NOT 23 separate requests.

Run: python3 test_e2e.py   (~6s — waits out the real 5s flush timer)
"""
import http.server
import socketserver
import threading
import json
import time
import argus

received = []  # one entry per POST = number of attempts it carried


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            received.append(len(json.loads(body)["attempts"]))
        except Exception:
            received.append(-1)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):
        pass  # silence the default request logging


class Usage:
    def __init__(self, n):
        self.input_tokens = n
        self.output_tokens = n


class Result:
    def __init__(self, n):
        self.usage = Usage(n)
        self.stop_reason = "end_turn"


def main():
    httpd = socketserver.TCPServer(("localhost", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    argus.init(endpoint=f"http://localhost:{port}", api_key="test-key")

    def call(i):
        return argus.track(provider="anthropic", model="claude-test", fn=lambda: Result(i))

    # Size trigger: 20 calls → exactly one batch of 20.
    for i in range(20):
        call(i)
    # 3 more → buffered, flushed by the 5s timer.
    for i in range(3):
        call(i)

    time.sleep(6)  # wait past FLUSH_MS

    print("23 track() calls made")
    print("HTTP POSTs received:", len(received))
    print("Attempts per POST:  ", received)
    assert len(received) == 2, f"23 calls should produce 2 POSTs, got {len(received)}"
    assert received[0] == 20, "first POST = size-triggered batch of 20"
    assert received[1] == 3, "second POST = timer-triggered batch of 3"
    print("\nok PASS - 23 calls collapsed into 2 batched POSTs (20 + 3)")
    httpd.shutdown()


if __name__ == "__main__":
    main()

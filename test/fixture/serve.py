#!/usr/bin/env python3
"""E2E 検証用のミニサーバ。

  /testuser/following          -> following.html (X のフォロー中ページの DOM を模す)
  /i/api/graphql/Following     -> graphql-following.json (X の GraphQL 応答を模す)

拡張の content script が 127.0.0.1 でも動くようにしてあるので、
これで「DOM + GraphQL 傍受 + ローカル d1 判定 + ハイライト」を通しで確認できる。
"""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, body: bytes, ctype: str):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/testuser/following", "/testuser/other"):
            self._send((ROOT / "following.html").read_bytes(), "text/html; charset=utf-8")
        elif path.startswith("/i/api/graphql/"):
            self._send(
                (ROOT / "graphql-following.json").read_bytes(),
                "application/json; charset=utf-8",
            )
        else:
            self.send_response(404)
            self.end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"fixture server: http://127.0.0.1:{args.port}/testuser/following", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

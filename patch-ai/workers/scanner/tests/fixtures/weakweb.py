"""A deliberately misconfigured web app for the local live-scan smoke test.

Usage: python weakweb.py <verification-token> [port]
"""

import html
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 80


class Handler(BaseHTTPRequestHandler):
    server_version = "Apache/2.4.49"

    def send(self, body: str, ctype: str = "text/html", extra: dict | None = None):
        data = body.encode()
        self.send_response(200)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.send_header("x-powered-by", "PHP/7.2.1")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        if url.path == "/.well-known/patchai-verify.txt":
            return self.send(f"patchai-verify={TOKEN}\n", "text/plain")
        if url.path == "/.env":
            return self.send("DB_PASSWORD=FIXTURE\nAPP_KEY=FIXTURE\n", "text/plain")
        if url.path == "/.git/HEAD":
            return self.send("ref: refs/heads/main\n", "text/plain")
        if url.path == "/search":
            q = parse_qs(url.query).get("q", [""])[0]
            return self.send(f"<html><body>Results for {q}</body></html>")  # reflected XSS on purpose
        origin = self.headers.get("origin")
        extra = {"set-cookie": "sessionid=abc123; Path=/"}
        if origin:
            extra |= {"access-control-allow-origin": origin, "access-control-allow-credentials": "true"}
        return self.send(
            f"<html><body><h1>Weak shop</h1><a href='/search?q=shoes'>{html.escape('search')}</a></body></html>",
            extra=extra,
        )

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

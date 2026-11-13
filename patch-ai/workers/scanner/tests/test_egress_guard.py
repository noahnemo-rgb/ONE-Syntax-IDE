import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from patchai_worker.egress_guard import EgressGuard


class Hello(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        body = f"hello {self.headers.get('host')} {self.path}".encode()
        self.send_response(200)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def upstream():
    """A local web server on port 80 if we may bind it, else skip."""
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 80), Hello)
    except OSError as exc:
        pytest.skip(f"cannot bind port 80 in this environment ({exc.strerror})")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()


def raw(guard: EgressGuard, request: bytes) -> bytes:
    with socket.create_connection(("127.0.0.1", guard.port), timeout=5) as s:
        s.sendall(request)
        return s.recv(4096)


def test_policy_allows_only_the_verified_host_and_web_ports():
    guard = EgressGuard("app.example.com", "203.0.113.10")
    assert guard.check("app.example.com", 443)
    assert guard.check("APP.example.com.", 80)
    assert not guard.check("app.example.com", 22)
    assert not guard.check("evil.example.com", 443)
    assert not guard.check("203.0.113.10", 443)
    assert not guard.check("169.254.169.254", 80)


def test_other_hosts_are_refused():
    with EgressGuard("app.example.com", "127.0.0.1") as guard:
        assert raw(guard, b"CONNECT metadata.google.internal:443 HTTP/1.1\r\n\r\n").startswith(b"HTTP/1.1 403")
        assert raw(guard, b"CONNECT app.example.com:22 HTTP/1.1\r\n\r\n").startswith(b"HTTP/1.1 403")
        assert raw(guard, b"GET http://169.254.169.254/latest HTTP/1.1\r\n\r\n").startswith(b"HTTP/1.1 403")
        assert raw(guard, b"GET http://app.example.com:8080/ HTTP/1.1\r\n\r\n").startswith(b"HTTP/1.1 403")
        assert raw(guard, b"GET /relative HTTP/1.1\r\n\r\n").startswith(b"HTTP/1.1 400")
        assert guard.stats.denied == 4


def test_userinfo_cannot_smuggle_another_host():
    with EgressGuard("app.example.com", "127.0.0.1") as guard:
        assert raw(guard, b"GET http://app.example.com@evil.com/ HTTP/1.1\r\n\r\n").startswith(b"HTTP/1.1 403")


def test_allowed_requests_go_to_the_pinned_address(upstream):
    # The hostname does not resolve; the guard must connect to the pinned IP anyway.
    with EgressGuard("pinned.patchai.invalid", "127.0.0.1") as guard:
        res = httpx.get("http://pinned.patchai.invalid/x?y=1", proxy=guard.url, timeout=5)
        assert res.status_code == 200
        assert res.text == "hello pinned.patchai.invalid /x?y=1"
        assert guard.stats.allowed == 1


def test_connection_rate_limit_refuses_after_max_wait():
    with EgressGuard("app.example.com", "127.0.0.1", connections_per_second=1, max_wait=0) as guard:
        codes = [raw(guard, b"CONNECT app.example.com:443 HTTP/1.1\r\n\r\n")[:12] for _ in range(3)]
        assert b"HTTP/1.1 429" in codes
        assert guard.stats.throttled >= 1


def test_connection_rate_limit_smooths_bursts(upstream):
    import time

    with EgressGuard("pinned.patchai.invalid", "127.0.0.1", connections_per_second=5) as guard:
        started = time.monotonic()
        for _ in range(10):
            assert httpx.get("http://pinned.patchai.invalid/", proxy=guard.url, timeout=10).status_code == 200
        # A burst of 5 is admitted at once; the other 5 wait about 1s in total.
        assert time.monotonic() - started >= 0.8
        assert guard.stats.throttled == 0


def test_stop_signal_refuses_new_connections():
    stop = threading.Event()
    with EgressGuard("app.example.com", "127.0.0.1", should_stop=stop.is_set) as guard:
        stop.set()
        assert raw(guard, b"CONNECT app.example.com:443 HTTP/1.1\r\n\r\n").startswith(b"HTTP/1.1 503")

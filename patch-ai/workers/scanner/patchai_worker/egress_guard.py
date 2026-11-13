"""Forward proxy that is the only network exit for live-target scanner tools.

Every upstream connection goes to the single IP address that was resolved,
checked to be public and pinned before the scan started, on port 80 or 443.
Requests naming any other host are refused, so a tool that follows a redirect,
loads a third-party script or is tricked by DNS rebinding cannot reach anything
else. Because the upstream address is fixed per connection, keep-alive or
pipelined requests on an accepted connection can only ever reach that address.

The guard also rate-limits new connections, caps concurrent connections and
total bytes, and drops all traffic as soon as the scan is told to stop (user
cancellation or the platform kill switch).
"""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field

ALLOWED_PORTS = (80, 443)
MAX_HEAD = 16 * 1024


@dataclass
class GuardStats:
    allowed: int = 0
    denied: int = 0
    throttled: int = 0
    bytes: int = 0
    denied_hosts: set[str] = field(default_factory=set)


class EgressGuard:
    def __init__(
        self,
        hostname: str,
        pinned_ip: str,
        *,
        bind_host: str = "127.0.0.1",
        connections_per_second: float = 10,
        max_concurrent: int = 20,
        max_bytes: int = 1024 * 1024 * 1024,
        max_wait: float = 30,
        should_stop: Callable[[], bool] = lambda: False,
    ):
        self.max_wait = max_wait
        self.hostname = hostname.lower().rstrip(".")
        self.pinned_ip = pinned_ip
        self.bind_host = bind_host
        self.rate = connections_per_second
        self.max_concurrent = max_concurrent
        self.max_bytes = max_bytes
        self.should_stop = should_stop
        self.stats = GuardStats()
        self.port = 0
        self._burst = max(1.0, float(connections_per_second))
        self._tokens = self._burst
        self._last = time.monotonic()
        self._active = 0
        self._loop: asyncio.AbstractEventLoop | None = None
        self._server: asyncio.base_events.Server | None = None
        self._writers: set[asyncio.StreamWriter] = set()
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, name="egress-guard", daemon=True)

    # -- lifecycle -----------------------------------------------------------

    def __enter__(self) -> EgressGuard:
        self._thread.start()
        if not self._ready.wait(10) or not self.port:
            raise RuntimeError("egress guard failed to start")
        return self

    def __exit__(self, *exc) -> None:
        if self._loop:
            self._loop.call_soon_threadsafe(self._shutdown)
        self._thread.join(timeout=10)

    @property
    def url(self) -> str:
        return f"http://{self.bind_host}:{self.port}"

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        try:
            self._loop.run_until_complete(self._start())
            self._ready.set()
            self._loop.run_forever()
        finally:
            self._ready.set()
            self._loop.close()

    async def _start(self) -> None:
        self._server = await asyncio.start_server(self._handle, self.bind_host, 0)
        self.port = self._server.sockets[0].getsockname()[1]
        asyncio.get_running_loop().create_task(self._watch_stop())

    async def _watch_stop(self) -> None:
        while True:
            await asyncio.sleep(0.5)
            if self.should_stop():
                for w in list(self._writers):
                    w.close()

    def _shutdown(self) -> None:
        for w in list(self._writers):
            w.close()
        if self._server:
            self._server.close()
        for task in asyncio.all_tasks(self._loop):
            task.cancel()
        self._loop.call_later(0.1, self._loop.stop)

    # -- policy --------------------------------------------------------------

    def _take_token(self) -> bool:
        now = time.monotonic()
        self._tokens = min(self._burst, self._tokens + (now - self._last) * self.rate)
        self._last = now
        if self._tokens >= 1:
            self._tokens -= 1
            return True
        return False

    async def _admit(self) -> bool:
        """Queues the connection until the rate and concurrency limits allow it.

        Smoothing instead of refusing keeps tools from mistaking throttling for
        target behaviour; only connections that wait longer than `max_wait` fail.
        """
        deadline = time.monotonic() + self.max_wait
        while True:
            if self._active < self.max_concurrent and self._take_token():
                return True
            if time.monotonic() >= deadline or self.should_stop():
                return False
            await asyncio.sleep(0.05)

    def check(self, host: str, port: int) -> bool:
        return host.lower().rstrip(".") == self.hostname and port in ALLOWED_PORTS

    # -- connection handling -------------------------------------------------

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._writers.add(writer)
        try:
            await self._serve(reader, writer)
        except (ConnectionError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError):
            pass
        finally:
            self._writers.discard(writer)
            writer.close()

    async def _reply(self, writer: asyncio.StreamWriter, status: str, text: str = "") -> None:
        body = text.encode()
        writer.write(
            f"HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
            + body
        )
        await writer.drain()

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if self.should_stop():
            return await self._reply(writer, "503 Service Unavailable", "scan stopped")
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=30)
        if len(head) > MAX_HEAD:
            return await self._reply(writer, "431 Request Header Fields Too Large")
        request_line, _, rest = head.partition(b"\r\n")
        try:
            method, target, version = request_line.decode("latin-1").split(" ", 2)
        except ValueError:
            return await self._reply(writer, "400 Bad Request")

        if method.upper() == "CONNECT":
            host, _, port_s = target.rpartition(":")
            host = host.strip("[]")
            port = int(port_s) if port_s.isdigit() else -1
            forward = b""
        else:
            if not target.lower().startswith("http://"):
                return await self._reply(writer, "400 Bad Request", "absolute-form http:// URL required")
            authority, slash, path = target[7:].partition("/")
            authority = authority.rpartition("@")[2]
            host, _, port_s = authority.partition(":")
            port = int(port_s) if port_s else 80
            if port != 80:
                port = -1
            forward = f"{method} {slash}{path} {version}\r\n".encode("latin-1") + rest

        if not self.check(host, port):
            self.stats.denied += 1
            self.stats.denied_hosts.add(f"{host}:{port}")
            return await self._reply(writer, "403 Forbidden", "destination not allowed for this scan")
        if not await self._admit():
            self.stats.throttled += 1
            return await self._reply(writer, "429 Too Many Requests", "scan rate limit")
        if self.stats.bytes > self.max_bytes:
            return await self._reply(writer, "507 Insufficient Storage", "scan traffic budget exhausted")

        self._active += 1
        self.stats.allowed += 1
        try:
            up_reader, up_writer = await asyncio.wait_for(asyncio.open_connection(self.pinned_ip, port), timeout=15)
        except (OSError, TimeoutError):
            self._active -= 1
            return await self._reply(writer, "502 Bad Gateway", "target unreachable")
        self._writers.add(up_writer)
        try:
            if method.upper() == "CONNECT":
                writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                await writer.drain()
            else:
                up_writer.write(forward)
                await up_writer.drain()
            await asyncio.gather(self._pipe(reader, up_writer), self._pipe(up_reader, writer))
        finally:
            self._active -= 1
            self._writers.discard(up_writer)
            up_writer.close()

    async def _pipe(self, src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
        try:
            while not self.should_stop():
                chunk = await asyncio.wait_for(src.read(65536), timeout=120)
                if not chunk:
                    break
                self.stats.bytes += len(chunk)
                if self.stats.bytes > self.max_bytes:
                    break
                dst.write(chunk)
                await dst.drain()
        except (ConnectionError, TimeoutError, asyncio.CancelledError):
            pass
        finally:
            if dst.can_write_eof():
                try:
                    dst.write_eof()
                except (OSError, RuntimeError):
                    pass

"""Loopback-only native capture bridge for the original Saleae Logic.

The bridge uses the device's existing WinUSB driver and documented vendor
protocol. It performs no control transfers and never writes firmware, RAM, or
EEPROM. Only EP1 OUT commands and EP2 IN sample transfers are used.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

import usb1


HOST = "127.0.0.1"
PORT = 43127
QUEUE_DEPTH = 32
CHUNK_SIZE = 4096
ALLOWED_ORIGINS_ENV = "PC_TOOLBOX_ALLOWED_ORIGINS"
LOCAL_DEVELOPMENT_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
DIVIDERS = {
    200_000: 0x4E,
    250_000: 0x9E,
    500_000: 0xFE,
    1_000_000: 0x8E,
    2_000_000: 0xE6,
    4_000_000: 0xDA,
    8_000_000: 0xD4,
    12_000_000: 0xE2,
    16_000_000: 0xD5,
    24_000_000: 0xE0,
}
CAPTURE_LOCK = threading.Lock()


def normalize_https_origin(value: str) -> str:
    candidate = value.strip()
    try:
        parsed = urlsplit(candidate)
        hostname_value = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"invalid HTTPS origin: {error}") from error
    if parsed.scheme.lower() != "https" or not hostname_value:
        raise argparse.ArgumentTypeError("origin must use https:// and include a hostname")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise argparse.ArgumentTypeError("origin must not contain credentials, a path, query, or fragment")
    if "*" in hostname_value:
        raise argparse.ArgumentTypeError("wildcard origins are not allowed")
    try:
        hostname = hostname_value.encode("idna").decode("ascii").lower()
    except UnicodeError as error:
        raise argparse.ArgumentTypeError(f"invalid HTTPS origin: {error}") from error
    rendered_host = f"[{hostname}]" if ":" in hostname else hostname
    rendered_port = f":{port}" if port is not None and port != 443 else ""
    return f"https://{rendered_host}{rendered_port}"


def configured_https_origins(cli_origins: list[str]) -> frozenset[str]:
    origins = set(cli_origins)
    for raw_origin in os.environ.get(ALLOWED_ORIGINS_ENV, "").split(","):
        if raw_origin.strip():
            origins.add(normalize_https_origin(raw_origin))
    return frozenset(origins)


def is_local_development_origin(origin: str) -> bool:
    try:
        parsed = urlsplit(origin)
        _ = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme.lower() == "http"
        and parsed.hostname in LOCAL_DEVELOPMENT_HOSTS
        and parsed.username is None
        and parsed.password is None
        and parsed.path in ("", "/")
        and not parsed.query
        and not parsed.fragment
    )


def capture(rate: int, sample_count: int, timeout_ms: int = 3000) -> bytes:
    if rate not in DIVIDERS:
        raise ValueError(f"unsupported sample rate: {rate}")
    if sample_count < 1024 or sample_count > 8_000_000:
        raise ValueError("sampleCount must be between 1024 and 8000000")

    # High-speed firmware expects full USB transfer blocks. Requesting a final
    # non-packet-aligned remainder (for example 144 bytes for 250000 samples)
    # can stop the stream, so capture whole 4096-byte blocks and trim in memory.
    requested_blocks = math.ceil(sample_count / CHUNK_SIZE)
    transfer_blocks = math.ceil(requested_blocks / QUEUE_DEPTH) * QUEUE_DEPTH
    chunks: list[bytes] = []
    transfers: list[usb1.USBTransfer] = []
    completed = 0
    submitted = 0
    failure: Exception | None = None

    def on_transfer(transfer: usb1.USBTransfer) -> None:
        nonlocal completed, submitted, failure
        status = transfer.getStatus()
        actual = transfer.getActualLength()
        buffer = bytes(transfer.getBuffer()[:actual])
        # Reading small completion metadata before re-submitting mirrors the
        # stable native probe path and avoids reusing a WinUSB transfer object
        # in the same instant its completion is delivered.
        _completion_marker = (time.perf_counter(), buffer[:16].hex(" "))
        if status != usb1.TRANSFER_COMPLETED or actual != CHUNK_SIZE:
            failure = RuntimeError(f"EP2 transfer {completed} failed: status={status}, expected={CHUNK_SIZE}, actual={actual}")
            return
        chunks.append(buffer)
        completed += 1
        if submitted < transfer_blocks:
            transfer.setBulk(0x82, CHUNK_SIZE, callback=on_transfer, timeout=timeout_ms)
            submitted += 1
            transfer.submit()

    with usb1.USBContext() as context:
        handle = context.openByVendorIDAndProductID(0x0925, 0x3881, skip_on_error=True)
        if handle is None:
            raise RuntimeError("Saleae Logic 0x0925:0x3881 not found, busy, or not using WinUSB")
        with handle.claimInterface(0):
            initial_depth = min(QUEUE_DEPTH, transfer_blocks)
            for _ in range(initial_depth):
                transfer = handle.getTransfer()
                transfer.setBulk(0x82, CHUNK_SIZE, callback=on_transfer, timeout=timeout_ms)
                transfer.submit()
                transfers.append(transfer)
                submitted += 1
            written = handle.bulkWrite(0x01, bytes((0xD5, DIVIDERS[rate])), timeout=timeout_ms)
            if written != 2:
                raise RuntimeError(f"EP1 command length mismatch: {written}")
            deadline = time.perf_counter() + timeout_ms / 1000 + sample_count / rate + 1
            while completed < transfer_blocks and failure is None and time.perf_counter() < deadline:
                context.handleEventsTimeout(0.05)
            if failure is None and completed != transfer_blocks:
                failure = TimeoutError(f"capture timeout: completed {completed}/{transfer_blocks} transfers")
            if failure is not None or completed != transfer_blocks:
                for transfer in transfers:
                    if transfer.isSubmitted():
                        try:
                            transfer.cancel()
                        except usb1.USBErrorNotFound:
                            pass
                cancel_deadline = time.perf_counter() + 1
                while any(transfer.isSubmitted() for transfer in transfers) and time.perf_counter() < cancel_deadline:
                    context.handleEventsTimeout(0.05)

    if failure is not None:
        raise failure
    return b"".join(chunks)[:sample_count]


class BridgeServer(ThreadingHTTPServer):
    allowed_https_origins: frozenset[str] = frozenset()


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "PC-Toolbox-Logic-Bridge/0.1"

    def allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin is None:
            return ""
        configured = getattr(self.server, "allowed_https_origins", frozenset())
        if is_local_development_origin(origin) or origin in configured:
            return origin
        return None

    def common_headers(self, content_type: str, length: int) -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.common_headers("application/json; charset=utf-8", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:  # noqa: N802
        origin = self.allowed_origin()
        if not origin:
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin, Access-Control-Request-Private-Network")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_error(404)
            return
        if self.allowed_origin() is None:
            self.send_error(403)
            return
        self.send_json(200, {
            "name": "PC Toolbox Logic Bridge",
            "protocol": "Saleae original new",
            "transport": "WinUSB/libusb asynchronous",
            "queueDepth": QUEUE_DEPTH,
            "chunkSize": CHUNK_SIZE,
            "sampleRates": list(DIVIDERS),
            "firmwareWrites": False,
        })

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/capture":
            self.send_error(404)
            return
        if self.allowed_origin() is None:
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096:
                raise ValueError("invalid request length")
            request = json.loads(self.rfile.read(length))
            rate = int(request["sampleRate"])
            sample_count = int(request["sampleCount"])
            with CAPTURE_LOCK:
                started = time.perf_counter()
                samples = capture(rate, sample_count)
                duration_ms = round((time.perf_counter() - started) * 1000, 3)
            self.send_response(200)
            self.common_headers("application/octet-stream", len(samples))
            self.send_header("X-PC-Toolbox-Sample-Rate", str(rate))
            self.send_header("X-PC-Toolbox-Capture-Ms", str(duration_ms))
            self.send_header("Access-Control-Expose-Headers", "X-PC-Toolbox-Sample-Rate, X-PC-Toolbox-Capture-Ms")
            self.end_headers()
            self.wfile.write(samples)
        except (ValueError, KeyError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:  # Hardware errors must reach the UI.
            self.send_json(503, {"error": str(error)})

    def log_message(self, message: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Loopback-only native capture bridge for PC Toolbox")
    parser.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        type=normalize_https_origin,
        metavar="HTTPS_ORIGIN",
        help="allow one exact HTTPS page origin; repeat for multiple deployments",
    )
    args = parser.parse_args(argv)
    try:
        allowed_https_origins = configured_https_origins(args.allow_origin)
    except argparse.ArgumentTypeError as error:
        parser.error(f"{ALLOWED_ORIGINS_ENV}: {error}")

    print(f"PC Toolbox Logic Bridge listening on http://{HOST}:{PORT}")
    print("Safety: no control transfers or firmware/RAM/EEPROM writes")
    print("Allowed local development hosts over HTTP (any port): 127.0.0.1, localhost, ::1")
    for origin in sorted(allowed_https_origins):
        print(f"Allowed HTTPS origin: {origin}")
    with BridgeServer((HOST, PORT), BridgeHandler) as server:
        server.allowed_https_origins = allowed_https_origins
        server.serve_forever()


if __name__ == "__main__":
    main()

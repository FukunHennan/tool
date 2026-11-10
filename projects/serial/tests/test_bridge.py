"""串口助手桥接服务 · 协议测试

覆盖 WebSocket 握手向量、帧编解码、掩码强制，以及一个真实的
socket 会话（握手 → list → ports 帧）。
"""

import json
import socket
import struct
import threading
import time
import unittest

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bridge import (  # noqa: E402
    BridgeError, MAX_FRAME, decode_frame, encode_frame, handle_client, origin_allowed, ws_accept,
)


def masked_frame(payload):
    """构造一个合法客户端帧（带掩码、opcode=1、FIN）。"""
    mask = b"\x01\x02\x03\x04"
    body = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    length = len(payload)
    if length < 126:
        head = bytes([0x81, 0x80 | length])
    elif length < 65536:
        head = bytes([0x81, 0x80 | 126]) + struct.pack(">H", length)
    else:
        head = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", length)
    return head + mask + body


class WsAcceptTest(unittest.TestCase):
    def test_rfc6455_vector(self):
        # RFC 6455 §1.3 官方示例
        self.assertEqual(
            ws_accept("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
        )


class FrameCodecTest(unittest.TestCase):
    def test_short_payload(self):
        frame = masked_frame(b"hello")
        self.assertEqual(decode_frame(frame, mask_required=True), (0x1, b"hello", b""))

    def test_payload_126_boundary(self):
        payload = bytes(range(256))
        frame = masked_frame(payload)
        self.assertEqual(decode_frame(frame, mask_required=True)[1], payload)

    def test_payload_127_boundary(self):
        payload = b"x" * 70_000
        frame = masked_frame(payload)
        self.assertEqual(decode_frame(frame, mask_required=True)[1], payload)

    def test_partial_frame_buffers(self):
        frame = masked_frame(b"abcdef")
        buf = bytearray()
        got = None
        for i in range(len(frame)):
            buf.extend(frame[i:i + 1])
            parsed = decode_frame(bytes(buf), mask_required=True)
            if parsed[0] is not None:
                got = parsed
                break
        self.assertIsNotNone(got)
        self.assertEqual(got[1], b"abcdef")
        self.assertEqual(got[2], b"")

    def test_unmasked_client_frame_rejected(self):
        with self.assertRaises(BridgeError):
            decode_frame(encode_frame(0x1, b"naked"), mask_required=True)

    def test_server_frame_is_unmasked(self):
        frame = encode_frame(0x1, b"from-server")
        self.assertEqual(decode_frame(frame, mask_required=False)[1], b"from-server")

    def test_oversized_frame_rejected(self):
        head = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", MAX_FRAME + 1) + b"\x00\x00\x00\x00"
        with self.assertRaises(BridgeError):
            decode_frame(head, mask_required=True)


class OriginTest(unittest.TestCase):
    def test_origin_allowlist(self):
        self.assertTrue(origin_allowed("http://127.0.0.1:8765"))
        self.assertTrue(origin_allowed("http://localhost:8765"))
        self.assertTrue(origin_allowed("https://localhost:8443"))
        self.assertTrue(origin_allowed("file://"))
        self.assertFalse(origin_allowed(None))
        self.assertFalse(origin_allowed("http://127.0.0.2:8765"))
        self.assertFalse(origin_allowed("https://evil.example"))
        self.assertFalse(origin_allowed("http://127.0.0.1.evil.com"))

    def test_bad_origin_rejected(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve():
            conn, _ = server.accept()
            handle_client(conn)
            server.close()

        threading.Thread(target=serve, daemon=True).start()
        client = socket.create_connection(("127.0.0.1", port))
        client.sendall(
            b"GET / HTTP/1.1\r\n"
            b"Host: 127.0.0.1\r\n"
            b"Upgrade: websocket\r\n"
            b"Connection: Upgrade\r\n"
            b"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            b"Origin: https://evil.example\r\n"
            b"\r\n"
        )
        response = client.recv(4096)
        client.close()
        self.assertIn(b"403 Forbidden", response)


class HandshakeTest(unittest.TestCase):
    """真实 socket 会话：握手 → 发 list → 收到 ports 文本帧。"""

    def test_handshake_and_list(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve():
            conn, _ = server.accept()
            handle_client(conn)
            server.close()

        threading.Thread(target=serve, daemon=True).start()

        client = socket.create_connection(("127.0.0.1", port))
        key = "dGhlIHNhbXBsZSBub25jZQ=="
        request = (
            "GET / HTTP/1.1\r\n"
            "Host: 127.0.0.1\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Origin: http://127.0.0.1:8765\r\n"
            "\r\n"
        )
        client.sendall(request.encode())
        buf = bytearray()
        while b"\r\n\r\n" not in buf:
            buf.extend(client.recv(4096))
        head, rest = bytes(buf).split(b"\r\n\r\n", 1)
        self.assertIn(b"101 Switching Protocols", head)
        self.assertIn(ws_accept(key).encode(), head)

        client.sendall(masked_frame(json.dumps({"type": "list"}).encode()))

        recv = bytearray(rest)
        got = None
        deadline = time.time() + 3
        while got is None and time.time() < deadline:
            if len(recv) < 2:
                recv.extend(client.recv(4096))
                continue
            parsed = decode_frame(bytes(recv), mask_required=False)
            if parsed[0] is None:
                recv.extend(client.recv(4096))
                continue
            got = parsed
        client.close()
        self.assertIsNotNone(got)
        opcode, payload, _ = got
        self.assertEqual(opcode, 0x1)
        msg = json.loads(payload.decode())
        self.assertEqual(msg["type"], "ports")
        self.assertIsInstance(msg["ports"], list)


if __name__ == "__main__":
    unittest.main()

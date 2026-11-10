#!/usr/bin/env python3
"""串口助手 · 本机桥接服务

Web Serial 在 MiMo Desktop 内置浏览器（Electron）里不可用；此服务把串口能力
通过 WebSocket 暴露给任意浏览器页面：列表、打开、读写、关闭，协议为 JSON 文本帧。

仅监听 127.0.0.1，数据不出本机。

用法：python projects/serial/bridge.py [--port 8787]
"""

import argparse
import base64
import hashlib
import json
import socket
import struct
import threading
from collections import deque

import serial
import serial.tools.list_ports
from serial.serialutil import SerialException

WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 1 << 20  # 单帧 1MB
READ_CHUNK = 4096


class BridgeError(Exception):
    pass


# ---------------- WebSocket 协议（RFC 6455 子集） ----------------

def ws_accept(key: str) -> str:
    digest = hashlib.sha1((key + WS_MAGIC).encode()).digest()
    return base64.b64encode(digest).decode()


def encode_frame(opcode: int, payload: bytes) -> bytes:
    first = 0x80 | opcode  # FIN
    length = len(payload)
    if length < 126:
        header = bytes([first, length])
    elif length < 65536:
        header = bytes([first, 126]) + struct.pack(">H", length)
    else:
        header = bytes([first, 127]) + struct.pack(">Q", length)
    return header + payload


def decode_frame(data: bytes, mask_required: bool):
    """解析一个完整帧；数据不足时返回 (None, data) 等待更多。

    mask_required: 客户端帧必须带掩码；返回 (opcode, payload, rest)。
    """
    if len(data) < 2:
        return None, data
    first, second = data[0], data[1]
    fin = bool(first & 0x80)
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F

    if length == 126:
        need = 4
    elif length == 127:
        need = 10
    else:
        need = 2
    if len(data) < need:
        return None, data
    if length == 126:
        (length,) = struct.unpack(">H", data[2:4])
    elif length == 127:
        (length,) = struct.unpack(">Q", data[2:10])
    if length > MAX_FRAME:
        raise BridgeError("frame too large")

    offset = need
    if masked:
        if len(data) < offset + 4:
            return None, data
        mask = data[offset:offset + 4]
        offset += 4
    if len(data) < offset + length:
        return None, data

    payload = data[offset:offset + length]
    rest = data[offset + length:]
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    elif mask_required:
        raise BridgeError("client frame must be masked")
    if not fin:
        raise BridgeError("fragmented frames not supported")
    return (opcode, payload, rest)


# ---------------- 桥接会话 ----------------

class SerialSession:
    """一个 WebSocket 连接对应一个打开的串口（同一时间仅一个）。"""

    def __init__(self, conn):
        self.conn = conn
        self.lock = threading.Lock()
        self.serial_port = None
        self.read_thread = None
        self.closed = False

    def send(self, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode()
        with self.lock:
            if not self.closed:
                try:
                    self.conn.sendall(encode_frame(0x1, payload))
                except OSError:
                    pass

    def _handle(self, msg):
        kind = msg.get("type")
        if kind == "list":
            ports = [
                {"path": p.device, "description": p.description}
                for p in serial.tools.list_ports.comports()
            ]
            self.send({"type": "ports", "ports": ports})
            return
        if kind == "open":
            if self.serial_port is not None:
                raise BridgeError("already open")
            opts = msg.get("options", {})
            ser = serial.Serial()
            ser.port = msg.get("path")
            ser.baudrate = int(opts.get("baudRate", 115200))
            ser.bytesize = {"5": 5, "6": 6, "7": 7, "8": 8}.get(str(opts.get("dataBits", 8)), 8)
            ser.parity = {"none": "N", "even": "E", "odd": "O"}.get(str(opts.get("parity", "none")), "N")
            ser.stopbits = {1: 1, 2: 2}.get(int(opts.get("stopBits", 1)), 1)
            flow = str(opts.get("flowControl", "none"))
            ser.rtscts = flow == "hardware"
            ser.xonxoff = flow == "software"
            ser.timeout = 0.1
            try:
                ser.open()
            except (SerialException, OSError, ValueError) as error:
                raise BridgeError(f"open failed: {error}") from error
            self.serial_port = ser
            self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self.read_thread.start()
            self.send({"type": "opened", "info": {"path": ser.portstr}})
            return
        if kind == "write":
            if self.serial_port is None:
                raise BridgeError("not open")
            try:
                payload = bytes.fromhex(msg.get("data", ""))
            except ValueError as error:
                raise BridgeError(f"bad hex: {error}") from error
            try:
                self.serial_port.write(payload)
                self.serial_port.flush()
            except (SerialException, OSError) as error:
                raise BridgeError(f"write failed: {error}") from error
            return
        if kind == "close":
            self._close_serial()
            self.send({"type": "closed", "reason": "user"})
            return
        raise BridgeError(f"unknown message: {kind}")

    def _read_loop(self):
        ser = self.serial_port
        try:
            while ser.is_open:
                data = ser.read(READ_CHUNK)
                if data:
                    self.send({"type": "data", "data": data.hex()})
        except (OSError, SerialException):
            pass
        finally:
            self._close_serial()
            self.send({"type": "closed", "reason": "device-gone"})

    def _close_serial(self):
        ser, self.serial_port = self.serial_port, None
        if ser is not None and ser.is_open:
            try:
                ser.close()
            except OSError:
                pass

    def run(self):
        """接收循环：读帧 → 路由到 _handle 或应答 ping/close。"""
        buf = bytearray()
        try:
            while True:
                chunk = self.conn.recv(4096)
                if not chunk:
                    break
                buf.extend(chunk)
                while buf:
                    parsed = decode_frame(bytes(buf), mask_required=True)
                    if parsed[0] is None:
                        break
                    opcode, payload, rest = parsed
                    del buf[: len(buf) - len(rest)]
                    if opcode == 0x8:  # close
                        with self.lock:
                            self.conn.sendall(encode_frame(0x8, payload[:2]))
                        return
                    if opcode == 0x9:  # ping
                        with self.lock:
                            self.conn.sendall(encode_frame(0xA, payload))
                        continue
                    if opcode == 0x1:  # text
                        try:
                            self._handle(json.loads(payload.decode()))
                        except (BridgeError, KeyError, ValueError, SerialException) as error:
                            self.send({"type": "error", "message": str(error)})
                        continue
                    # binary 忽略
        finally:
            self._close_serial()
            try:
                self.conn.close()
            except OSError:
                pass


# ---------------- 服务器 ----------------

ALLOWED_ORIGINS = ("http://127.0.0.1:", "http://localhost:", "https://localhost:", "file://")


def origin_allowed(origin: str | None) -> bool:
    return origin is not None and origin.startswith(ALLOWED_ORIGINS)


def handle_client(conn):
    try:
        key = None
        origin = None
        buf = bytearray()
        while b"\r\n\r\n" not in buf:
            chunk = conn.recv(4096)
            if not chunk:
                return
            buf.extend(chunk)
            if len(buf) > 16 * 1024:
                return
        head = bytes(buf).split(b"\r\n\r\n", 1)[0].decode("latin1")
        for line in head.split("\r\n")[1:]:
            name, _, value = line.partition(":")
            lowered = name.strip().lower()
            if lowered == "sec-websocket-key":
                key = value.strip()
            elif lowered == "origin":
                origin = value.strip()
        if key is None:
            conn.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            return
        if not origin_allowed(origin):
            conn.sendall(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            return
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {ws_accept(key)}\r\n"
            "\r\n"
        )
        conn.sendall(response.encode())
        SerialSession(conn).run()
    except OSError:
        pass
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="串口助手桥接服务")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.host, args.port))
    server.listen(4)
    print(f"串口桥接服务 http://{args.host}:{args.port}/  (Ctrl+C 退出)", flush=True)
    while True:
        conn, _ = server.accept()
        threading.Thread(target=handle_client, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    main()

"""Native WinUSB/libusb probe for the original Saleae Logic protocol.

This tool never performs control transfers or firmware writes. It only sends
the documented two-byte sample-rate command to EP1 OUT and reads samples from
EP2 IN. Run it from the project virtual environment.
"""

from __future__ import annotations

import argparse
import json
import time

import libusb_package
import usb.core
import usb.util
from usb.backend import libusb1


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rate", type=int, default=24_000_000, choices=DIVIDERS)
    parser.add_argument("--chunks", type=int, default=64)
    parser.add_argument("--chunk-size", type=int, default=4096, choices=(512, 2048, 4096))
    parser.add_argument("--timeout", type=int, default=1500)
    args = parser.parse_args()

    backend = libusb1.get_backend(find_library=libusb_package.find_library)
    device = usb.core.find(idVendor=0x0925, idProduct=0x3881, backend=backend)
    if device is None:
        raise SystemExit("Saleae Logic 0x0925:0x3881 not found")

    report: dict[str, object] = {
        "transport": "native libusb over WinUSB",
        "firmwareWrites": False,
        "controlTransfers": False,
        "rate": args.rate,
        "command": [0xD5, DIVIDERS[args.rate]],
        "chunkSize": args.chunk_size,
        "requestedChunks": args.chunks,
        "reads": [],
    }
    interface = 0
    started = time.perf_counter()
    try:
        device.set_configuration()
        usb.util.claim_interface(device, interface)
        written = device.write(0x01, bytes(report["command"]), timeout=args.timeout)
        report["bytesWritten"] = int(written)
        received = 0
        for index in range(args.chunks):
            read_started = time.perf_counter()
            try:
                data = device.read(0x82, args.chunk_size, timeout=args.timeout)
                duration_ms = round((time.perf_counter() - read_started) * 1000, 3)
                received += len(data)
                report["reads"].append({
                    "index": index,
                    "length": len(data),
                    "durationMs": duration_ms,
                    "first16Hex": bytes(data[:16]).hex(" "),
                })
            except usb.core.USBError as error:
                report["reads"].append({
                    "index": index,
                    "length": 0,
                    "durationMs": round((time.perf_counter() - read_started) * 1000, 3),
                    "error": str(error),
                })
                report["error"] = str(error)
                break
        report["receivedBytes"] = received
    finally:
        report["durationMs"] = round((time.perf_counter() - started) * 1000, 3)
        try:
            usb.util.release_interface(device, interface)
        except usb.core.USBError:
            pass
        usb.util.dispose_resources(device)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("receivedBytes") == args.chunks * args.chunk_size else 1


if __name__ == "__main__":
    raise SystemExit(main())

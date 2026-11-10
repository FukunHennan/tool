"""Asynchronous libusb probe for Saleae Logic over the existing WinUSB driver.

All EP2 reads are submitted before the documented EP1 sample-rate command.
There are no control transfers and no firmware, RAM, or EEPROM writes.
"""

from __future__ import annotations

import argparse
import json
import time

import usb1


DIVIDERS = {
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
    parser.add_argument("--queue-depth", type=int, default=8)
    parser.add_argument("--chunk-size", type=int, default=4096, choices=(512, 2048, 4096))
    parser.add_argument("--timeout", type=int, default=2000)
    args = parser.parse_args()

    report: dict[str, object] = {
        "transport": "asynchronous libusb over WinUSB",
        "firmwareWrites": False,
        "controlTransfers": False,
        "rate": args.rate,
        "command": [0xD5, DIVIDERS[args.rate]],
        "chunkSize": args.chunk_size,
        "requestedChunks": args.chunks,
        "queueDepth": args.queue_depth,
        "reads": [],
    }
    statuses = {
        usb1.TRANSFER_COMPLETED: "completed",
        usb1.TRANSFER_ERROR: "error",
        usb1.TRANSFER_TIMED_OUT: "timed-out",
        usb1.TRANSFER_CANCELLED: "cancelled",
        usb1.TRANSFER_STALL: "stall",
        usb1.TRANSFER_NO_DEVICE: "no-device",
        usb1.TRANSFER_OVERFLOW: "overflow",
    }
    completed = 0
    submitted = 0
    received = 0
    transfers: list[usb1.USBTransfer] = []
    started = time.perf_counter()

    def on_transfer(transfer: usb1.USBTransfer) -> None:
        nonlocal completed, received, submitted
        actual = transfer.getActualLength()
        status = transfer.getStatus()
        buffer = bytes(transfer.getBuffer()[:actual])
        report["reads"].append({
            "completionIndex": completed,
            "status": statuses.get(status, str(status)),
            "length": actual,
            "elapsedMs": round((time.perf_counter() - started) * 1000, 3),
            "first16Hex": buffer[:16].hex(" "),
        })
        completed += 1
        received += actual
        if status == usb1.TRANSFER_COMPLETED and submitted < args.chunks:
            transfer.setBulk(0x82, args.chunk_size, callback=on_transfer, timeout=args.timeout)
            submitted += 1
            transfer.submit()

    with usb1.USBContext() as context:
        handle = context.openByVendorIDAndProductID(0x0925, 0x3881, skip_on_error=True)
        if handle is None:
            raise SystemExit("Saleae Logic 0x0925:0x3881 not found or busy")
        with handle.claimInterface(0):
            initial_depth = min(args.queue_depth, args.chunks)
            for _ in range(initial_depth):
                transfer = handle.getTransfer()
                transfer.setBulk(0x82, args.chunk_size, callback=on_transfer, timeout=args.timeout)
                transfer.submit()
                transfers.append(transfer)
                submitted += 1
            report["bytesWritten"] = handle.bulkWrite(0x01, bytes(report["command"]), timeout=args.timeout)
            deadline = time.perf_counter() + args.timeout / 1000 + 1
            while completed < args.chunks and time.perf_counter() < deadline:
                context.handleEventsTimeout(0.05)
            for transfer in transfers:
                if transfer.isSubmitted():
                    transfer.cancel()
            cancel_deadline = time.perf_counter() + 1
            while any(transfer.isSubmitted() for transfer in transfers) and time.perf_counter() < cancel_deadline:
                context.handleEventsTimeout(0.05)

    report["completedTransfers"] = completed
    report["receivedBytes"] = received
    report["durationMs"] = round((time.perf_counter() - started) * 1000, 3)
    report["statusCounts"] = {
        name: sum(1 for read in report["reads"] if read["status"] == name)
        for name in statuses.values()
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if received == args.chunks * args.chunk_size else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Stand-in for the provisioning app: sends Wi-Fi credentials to a board over
BLE using the contract in docs/ble-provisioning.md.

    uv run --with bleak tools/ble-provision-mock/provision.py --ssid NET --password PASS [--name ESP32-O1]
"""

import argparse
import asyncio
import json
import sys

from bleak import BleakClient, BleakScanner
from bleak.backends.characteristic import BleakGATTCharacteristic

SERVICE_UUID = "6e1f0001-7c3a-4b8e-9d2f-5a4b3c2d1e0f"
SSID_UUID = "6e1f0002-7c3a-4b8e-9d2f-5a4b3c2d1e0f"
PASSWORD_UUID = "6e1f0003-7c3a-4b8e-9d2f-5a4b3c2d1e0f"
CONTROL_UUID = "6e1f0004-7c3a-4b8e-9d2f-5a4b3c2d1e0f"
STATUS_UUID = "6e1f0005-7c3a-4b8e-9d2f-5a4b3c2d1e0f"
INFO_UUID = "6e1f0006-7c3a-4b8e-9d2f-5a4b3c2d1e0f"
APPLY = b"\x01"


async def find_board(name: str | None, timeout: float) -> object:
    print(f"scanning {timeout:.0f}s for provisioning service {SERVICE_UUID} ...")
    found = await BleakScanner.discover(timeout=timeout, service_uuids=[SERVICE_UUID])
    boards = [d for d in found if name is None or d.name == name]
    if not boards:
        sys.exit("no provisionable board found (is it unprovisioned and powered on?)")
    if len(boards) > 1:
        names = ", ".join(repr(d.name) for d in boards)
        sys.exit(f"several boards advertising ({names}) — pick one with --name")
    print(f"found {boards[0].name!r} ({boards[0].address})")
    return boards[0]


async def provision(args: argparse.Namespace) -> int:
    board = await find_board(args.name, args.scan_timeout)
    done = asyncio.Event()
    outcome: dict[str, str] = {}

    def on_status(_: BleakGATTCharacteristic, data: bytearray) -> None:
        try:
            status = json.loads(data.decode())
        except ValueError:
            print(f"status (unparseable): {data!r}")
            return
        print(f"status: {status}")
        if status.get("state") in ("connected", "failed"):
            outcome.update(status)
            done.set()

    async with BleakClient(board) as client:
        # Every characteristic requires an encrypted, bonded link.
        try:
            await client.pair()
        except NotImplementedError:
            print("this backend pairs on demand — continuing")
        print("info:", json.loads((await client.read_gatt_char(INFO_UUID)).decode()))
        await client.start_notify(STATUS_UUID, on_status)
        await client.write_gatt_char(SSID_UUID, args.ssid.encode(), response=True)
        await client.write_gatt_char(PASSWORD_UUID, args.password.encode(), response=True)
        await client.write_gatt_char(CONTROL_UUID, APPLY, response=True)
        try:
            await asyncio.wait_for(done.wait(), timeout=args.connect_timeout)
        except TimeoutError:
            # A board that connected reboots about a second after notifying,
            # which can drop the link before the notification lands.
            print("no final status before timeout — check the board's serial log / the dashboard")
            return 2

    if outcome.get("state") == "connected":
        print("provisioned — the board is rebooting onto the network")
        return 0
    print(f"failed: {outcome.get('reason') or 'unknown'}")
    return 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssid", required=True)
    parser.add_argument("--password", default="")
    parser.add_argument("--name", help="board's advertised name, when several are in range")
    parser.add_argument("--scan-timeout", type=float, default=8.0)
    parser.add_argument("--connect-timeout", type=float, default=40.0)
    args = parser.parse_args()
    if not 1 <= len(args.ssid.encode()) <= 32:
        sys.exit("--ssid must be 1-32 bytes")
    if len(args.password.encode()) > 64:
        sys.exit("--password must be at most 64 bytes")
    sys.exit(asyncio.run(provision(args)))


if __name__ == "__main__":
    main()

"""The /ws relay's coalescing (realtime/router.py _relay), as a plain async
function against a fake pubsub and websocket — see test_realtime.py for why
there's no WS TestClient in this suite."""

import asyncio
import json
from collections.abc import AsyncIterator

from app.realtime.router import _relay, batch_frame


class FakePubSub:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()

    async def listen(self) -> AsyncIterator[dict[str, object]]:
        while True:
            yield await self.queue.get()


class FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, data: str) -> None:
        self.sent.append(data)


def _event(i: int) -> dict[str, object]:
    return {"type": "message", "data": json.dumps({"type": "telemetry", "value": i})}


def test_batch_frame_keeps_a_lone_event_unwrapped() -> None:
    assert batch_frame(['{"type":"telemetry"}']) == '{"type":"telemetry"}'


def test_batch_frame_joins_events_into_one_valid_frame() -> None:
    frame = json.loads(batch_frame(['{"a":1}', '{"b":2}']))
    assert frame == {"type": "batch", "events": [{"a": 1}, {"b": 2}]}


async def test_relay_sends_one_frame_per_tick_with_every_event() -> None:
    pubsub, ws = FakePubSub(), FakeWebSocket()
    task = asyncio.create_task(_relay(pubsub, ws, 0.05))
    await pubsub.queue.put({"type": "subscribe", "data": 1})
    for i in range(20):
        await pubsub.queue.put(_event(i))
    await asyncio.sleep(0.12)
    task.cancel()

    assert len(ws.sent) == 1
    frame = json.loads(ws.sent[0])
    assert frame["type"] == "batch"
    assert [e["value"] for e in frame["events"]] == list(range(20))


async def test_relay_sends_nothing_on_an_idle_tick() -> None:
    pubsub, ws = FakePubSub(), FakeWebSocket()
    task = asyncio.create_task(_relay(pubsub, ws, 0.02))
    await asyncio.sleep(0.1)
    task.cancel()
    assert ws.sent == []

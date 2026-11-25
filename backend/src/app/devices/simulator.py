"""Simulated devices (ease-of-use plan B4): readings made up by the worker for
devices flagged `simulated`, so people can try rules, alerts and dashboards
without a board.

It behaves like a board from the outside: it publishes telemetry and a
retained status on the device's own topics through EMQX, answers commands on
`cmd/{actuator}` with an ack, and picks up the retained desired state at
start. Ingestion, the rules' hot path and storage see ordinary MQTT traffic
and don't change (CLAUDE.md §9.1). A switched-on fan, cooler or vent pulls
the device's temperature-like readings down, so a "too hot" rule visibly
closes its loop.

The value math is pure (next_value, command_reply) and unit-tested; the loop
around it only does I/O.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import aiomqtt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.devices import service as devices_service

log = logging.getLogger(__name__)

PUBLISH_INTERVAL_SECONDS = 5.0
RELOAD_INTERVAL_SECONDS = 10.0
STATUS_INTERVAL_SECONDS = 60.0
RECONNECT_SECONDS = 5.0
# One slow wave per this many seconds, so a chart shows movement within minutes.
WAVE_PERIOD_SECONDS = 600.0
FIRMWARE_LABEL = "simulated"

_COOLING = re.compile(r"fan|cool|vent|chill|ac\b", re.IGNORECASE)
_TEMPERATURE = re.compile(r"temp", re.IGNORECASE)

# Plausible ranges by what a reading looks like, when its template sets none.
_DEFAULT_RANGES: list[tuple[re.Pattern[str], tuple[float, float]]] = [
    (re.compile(r"temp", re.IGNORECASE), (18.0, 34.0)),
    (re.compile(r"humid", re.IGNORECASE), (35.0, 85.0)),
    (re.compile(r"dist|level|depth", re.IGNORECASE), (20.0, 180.0)),
    (re.compile(r"press", re.IGNORECASE), (990.0, 1030.0)),
]


@dataclass
class SimState:
    """What one simulated device remembers between ticks."""

    started: float
    # Actuator key -> its last value ("on" when truthy).
    outputs: dict[str, Any] = field(default_factory=dict)
    # Bool metric key -> its current state.
    flags: dict[str, bool] = field(default_factory=dict)
    # Per-metric phase, so two readings don't move in lockstep.
    phases: dict[str, float] = field(default_factory=dict)


def _label(row: dict[str, Any]) -> str:
    return f"{row.get('key', '')} {row.get('name', '')}"


def value_range(metric: dict[str, Any]) -> tuple[float, float]:
    """The metric's declared min/max, else a plausible range for its kind."""
    lo, hi = metric.get("min"), metric.get("max")
    if isinstance(lo, int | float) and isinstance(hi, int | float) and hi > lo:
        return float(lo), float(hi)
    for pattern, rng in _DEFAULT_RANGES:
        if pattern.search(_label(metric)):
            return rng
    return (0.0, 100.0)


def is_on(value: Any) -> bool:
    """A command or desired-state value read as on/off, whatever the template
    sends for On (true, 1, "on", "ON", "1")."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "on", "true", "open", "high"}
    return False


def cooling_on(actuators: list[dict[str, Any]], state: SimState) -> bool:
    return any(
        _COOLING.search(_label(a)) and is_on(state.outputs.get(str(a.get("key"))))
        for a in actuators
    )


def next_value(
    metric: dict[str, Any],
    actuators: list[dict[str, Any]],
    state: SimState,
    now: float,
    rng: random.Random,
) -> float | bool:
    """The metric's next reading: a slow wave across ¾ of its range with a
    little noise; an on/off reading flips now and then. A running fan pulls a
    temperature down by a third of its range. Rounded to the metric's decimals."""
    key = str(metric.get("key"))
    if metric.get("data_type") == "bool":
        current = state.flags.get(key, False)
        if rng.random() < 0.08:
            current = not current
        state.flags[key] = current
        return current
    lo, hi = value_range(metric)
    span = hi - lo
    phase = state.phases.setdefault(key, rng.random() * 2 * math.pi)
    wave = math.sin(2 * math.pi * (now - state.started) / WAVE_PERIOD_SECONDS + phase)
    value = lo + span * (0.5 + 0.375 * wave) + rng.uniform(-0.02, 0.02) * span
    if _TEMPERATURE.search(_label(metric)) and cooling_on(actuators, state):
        value -= span / 3
    value = min(hi, max(lo, value))
    decimals = metric.get("decimals")
    places = decimals if isinstance(decimals, int) and 0 <= decimals <= 6 else 1
    return round(value, places)


def command_reply(topic_actuator: str, payload: bytes, state: SimState) -> str | None:
    """Apply a command to the simulated outputs and return the ack payload,
    or None for a payload that isn't a command (never raises: MQTT payloads
    are untrusted, CLAUDE.md §9.11)."""
    try:
        body = json.loads(payload)
        command_id = str(uuid.UUID(str(body["command_id"])))
    except (ValueError, KeyError, TypeError):
        return None
    state.outputs[topic_actuator] = body.get("value")
    return json.dumps({"command_id": command_id})


def apply_desired_state(topic_actuator: str, payload: bytes, state: SimState) -> None:
    """The retained desired state, read at start like a board does on connect."""
    try:
        body = json.loads(payload)
    except ValueError:
        return
    if isinstance(body, dict) and "value" in body:
        state.outputs.setdefault(topic_actuator, body["value"])


def status_payload(state: SimState, now: float) -> str:
    return json.dumps(
        {
            "online": True,
            "rssi": -55,
            "uptime_s": int(now - state.started),
            "fw_version": FIRMWARE_LABEL,
            "faults": [],
        }
    )


ACK_DELAY_SECONDS = 0.5


async def _ack_later(client: aiomqtt.Client, topic: str, ack: str) -> None:
    await asyncio.sleep(ACK_DELAY_SECONDS)
    await client.publish(topic, ack, qos=1)


async def simulator_loop(factory: async_sessionmaker[AsyncSession]) -> None:
    """Publish readings for every simulated device, answer their commands.
    Its own broker connection, like the worker's other publishing loops."""
    rng = random.Random()
    states: dict[uuid.UUID, SimState] = {}
    if not settings.simulator_enabled:
        log.info("simulated devices are off (MQTT_SIMULATOR_PASSWORD not set for this deployment)")
        await asyncio.Event().wait()
    while True:
        try:
            async with aiomqtt.Client(
                settings.mqtt_host,
                port=settings.mqtt_port,
                username=settings.mqtt_simulator_username,
                password=settings.mqtt_simulator_password.get_secret_value(),
            ) as client:
                await _run(client, factory, states, rng)
        except aiomqtt.MqttError as exc:
            log.warning("simulator loop error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS)
            await asyncio.sleep(RECONNECT_SECONDS)


async def _run(
    client: aiomqtt.Client,
    factory: async_sessionmaker[AsyncSession],
    states: dict[uuid.UUID, SimState],
    rng: random.Random,
) -> None:
    devices: dict[tuple[str, str], devices_service.SimulatedDeviceRow] = {}
    subscribed: set[tuple[str, str]] = set()
    # Picked up since the last tick: say it's online now, not at the next status round.
    fresh: set[tuple[str, str]] = set()
    last_reload = last_status = 0.0

    async def reload() -> None:
        nonlocal devices
        rows = await devices_service.list_simulated_devices(factory)
        devices = {(r.tenant_slug, r.device_slug): r for r in rows}
        for slugs, row in devices.items():
            states.setdefault(row.device_id, SimState(started=time.time()))
            if slugs not in subscribed:
                # Its commands, and the retained desired state (delivered now).
                await client.subscribe(f"{slugs[0]}/{slugs[1]}/cmd/+", qos=1)
                await client.subscribe(f"{slugs[0]}/{slugs[1]}/state/+", qos=1)
                subscribed.add(slugs)
                fresh.add(slugs)
        for gone in subscribed - devices.keys():
            await client.unsubscribe(f"{gone[0]}/{gone[1]}/cmd/+")
            await client.unsubscribe(f"{gone[0]}/{gone[1]}/state/+")
            subscribed.discard(gone)

    async def handle_messages() -> None:
        async for message in client.messages:
            parts = str(message.topic).split("/")
            if len(parts) != 4 or parts[2] not in {"cmd", "state"}:
                continue
            row = devices.get((parts[0], parts[1]))
            if row is None:
                continue
            state = states[row.device_id]
            payload = (
                message.payload
                if isinstance(message.payload, bytes)
                else str(message.payload).encode()
            )
            if parts[2] == "state":
                apply_desired_state(parts[3], payload, state)
                continue
            ack = command_reply(parts[3], payload, state)
            if ack is not None:
                # A board takes a moment to switch; acking at once could beat
                # the platform's own write of the command row (it publishes first).
                acks.add(
                    asyncio.create_task(
                        _ack_later(client, f"{parts[0]}/{parts[1]}/ack/{parts[3]}", ack)
                    )
                )

    acks: set[asyncio.Task[None]] = set()
    listener = asyncio.create_task(handle_messages())
    try:
        while True:
            if listener.done():
                listener.result()  # surface the broker error to reconnect
            now = time.time()
            if now - last_reload >= RELOAD_INTERVAL_SECONDS:
                await reload()
                last_reload = now
            send_status = now - last_status >= STATUS_INTERVAL_SECONDS
            for (tenant_slug, device_slug), row in list(devices.items()):
                state = states[row.device_id]
                if send_status or (tenant_slug, device_slug) in fresh:
                    await client.publish(
                        f"{tenant_slug}/{device_slug}/status",
                        status_payload(state, now),
                        qos=1,
                        retain=True,
                    )
                for metric in row.metrics:
                    key = metric.get("key")
                    if not key:
                        continue
                    value = next_value(metric, row.actuators, state, now, rng)
                    await client.publish(
                        f"{tenant_slug}/{device_slug}/{key}", json.dumps({"value": value}), qos=0
                    )
            fresh.clear()
            if send_status:
                last_status = now
            await asyncio.sleep(PUBLISH_INTERVAL_SECONDS)
            acks = {t for t in acks if not t.done()}
    finally:
        listener.cancel()
        for t in acks:
            t.cancel()

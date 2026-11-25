"""The simulated device's value math (app.devices.simulator): pure, so tested
exhaustively without a broker."""

import json
import random
import uuid

from app.devices.simulator import (
    SimState,
    apply_desired_state,
    command_reply,
    is_on,
    next_value,
    status_payload,
    value_range,
)

TEMP = {
    "key": "temperature",
    "name": "Air temperature",
    "unit": "°C",
    "min": 0,
    "max": 60,
    "decimals": 1,
}
FAN = {"key": "fan", "name": "Fan"}


def _values(
    metric: dict[str, object], state: SimState, *, seconds: int = 1200
) -> list[float | bool]:
    rng = random.Random(7)
    return [next_value(metric, [FAN], state, state.started + t, rng) for t in range(0, seconds, 5)]


def test_numbers_stay_in_range_and_move() -> None:
    values = _values(TEMP, SimState(started=0.0))
    assert all(isinstance(v, float) and 0 <= v <= 60 for v in values)
    assert (
        max(values) - min(values) > 20
    )  # a visible wave, not a flat line  # type: ignore[operator]


def test_rounded_to_the_metrics_decimals() -> None:
    values = _values({**TEMP, "decimals": 0}, SimState(started=0.0), seconds=60)
    assert all(float(v).is_integer() for v in values)


def test_a_range_is_guessed_from_the_kind_of_reading() -> None:
    assert value_range({"key": "humidity", "name": "Humidity"}) == (35.0, 85.0)
    assert value_range({"key": "temp", "name": "T"}) == (18.0, 34.0)
    assert value_range({"key": "x", "name": "Something"}) == (0.0, 100.0)
    assert value_range({"key": "x", "name": "X", "min": 5, "max": 5}) == (0.0, 100.0)


def test_a_running_fan_pulls_the_temperature_down() -> None:
    off = _values(TEMP, SimState(started=0.0))
    on = _values(TEMP, SimState(started=0.0, outputs={"fan": True}))
    assert sum(on) / len(on) < sum(off) / len(off) - 10  # type: ignore[arg-type]


def test_on_off_readings_flip_now_and_then() -> None:
    values = _values(
        {"key": "door", "name": "Door open", "data_type": "bool"}, SimState(started=0.0)
    )
    assert set(values) == {True, False}


def test_commands_are_acked_and_switch_the_output() -> None:
    state = SimState(started=0.0)
    cid = uuid.uuid4()
    ack = command_reply(
        "fan", json.dumps({"value": 1, "command_id": str(cid), "ttl": 30}).encode(), state
    )
    assert ack is not None and json.loads(ack) == {"command_id": str(cid)}
    assert is_on(state.outputs["fan"])


def test_a_malformed_command_is_ignored_never_raised() -> None:
    state = SimState(started=0.0)
    for payload in [b"not json", b"{}", b'{"command_id": "nope"}', b"[]", b"null"]:
        assert command_reply("fan", payload, state) is None
    assert state.outputs == {}


def test_retained_desired_state_is_picked_up_but_a_command_wins() -> None:
    state = SimState(started=0.0, outputs={"pump": False})
    apply_desired_state("pump", b'{"value": true}', state)
    apply_desired_state("fan", b'{"value": "ON"}', state)
    apply_desired_state("vent", b"garbage", state)
    assert state.outputs == {"pump": False, "fan": "ON"}
    assert is_on(state.outputs["fan"])


def test_status_reads_online_with_no_faults() -> None:
    body = json.loads(status_payload(SimState(started=100.0), 160.0))
    assert body["online"] is True and body["uptime_s"] == 60 and body["faults"] == []


def test_a_temperature_starts_rising_to_its_peak_within_minutes() -> None:
    state = SimState(started=0.0)
    rng = random.Random(1)
    first = next_value(TEMP, [], state, 0.0, rng)
    at_peak = next_value(TEMP, [], state, 150.0, rng)
    assert 25 <= first <= 35  # type: ignore[operator]
    assert at_peak > 45  # the wave's top: 0.875 of 0-60 # type: ignore[operator]

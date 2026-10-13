"""Unit tests for app.catalog.service.check_hardware — the save-time version of
the channel → key checks the generic firmware makes at boot
(firmware/src/io.cpp). No DB.
"""

from typing import Any

import pytest

from app.catalog.service import HardwareMappingError, check_hardware

METRICS = [{"name": "Door", "key": "door"}, {"name": "Level", "key": "level"}]
ACTUATORS = [{"name": "Fan", "key": "fan1"}]


def _hw(
    inputs: list[dict[str, Any]] | None = None, outputs: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    return {"board": "esp32", "inputs": inputs or [], "outputs": outputs or []}


def _input(channels: dict[str, str], driver: str = "digital_in") -> dict[str, Any]:
    return {"driver": driver, "pins": {"pin": 13}, "channels": channels}


def _output(channels: dict[str, str]) -> dict[str, Any]:
    return {"driver": "relay", "pins": {"pin": 23}, "channels": channels}


def test_no_hardware_is_fine() -> None:
    check_hardware(None, METRICS, ACTUATORS)


def test_a_valid_mapping_passes() -> None:
    check_hardware(
        _hw(
            inputs=[_input({"value": "door"}), _input({"value": "level"}, driver="analog_in")],
            outputs=[_output({"value": "fan1"})],
        ),
        METRICS,
        ACTUATORS,
    )


def test_unbound_metrics_and_actuators_are_allowed() -> None:
    check_hardware(_hw(inputs=[_input({"value": "door"})]), METRICS, ACTUATORS)


def test_input_feeding_an_unknown_metric_is_rejected() -> None:
    with pytest.raises(HardwareMappingError, match="'humidity', which isn't a metric"):
        check_hardware(_hw(inputs=[_input({"value": "humidity"})]), METRICS, ACTUATORS)


def test_a_metric_fed_twice_is_rejected() -> None:
    with pytest.raises(HardwareMappingError, match="'door' is fed by two inputs"):
        check_hardware(
            _hw(inputs=[_input({"value": "door"}), _input({"value": "door"})]), METRICS, ACTUATORS
        )


def test_output_driving_an_unknown_actuator_is_rejected() -> None:
    with pytest.raises(HardwareMappingError, match="'pump', which isn't an actuator"):
        check_hardware(_hw(outputs=[_output({"value": "pump"})]), METRICS, ACTUATORS)


def test_an_actuator_driven_twice_is_rejected() -> None:
    with pytest.raises(HardwareMappingError, match="'fan1' is driven by two outputs"):
        check_hardware(
            _hw(outputs=[_output({"value": "fan1"}), _output({"value": "fan1"})]),
            METRICS,
            ACTUATORS,
        )


@pytest.mark.parametrize("channels", [{}, {"level": "fan1"}, {"value": "fan1", "extra": "fan1"}])
def test_an_output_needs_exactly_the_value_channel(channels: dict[str, str]) -> None:
    with pytest.raises(HardwareMappingError, match="exactly one channel"):
        check_hardware(_hw(outputs=[_output(channels)]), METRICS, ACTUATORS)

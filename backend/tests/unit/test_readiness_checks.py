"""Readiness judgements (app.readiness.service) and the worker's heartbeat
payload — pure, no Redis or DB."""

import json

from app import worker
from app.readiness.service import HEARTBEAT_MAX_AGE_SECONDS, heartbeat_check, stream_check

NOW = 1_800_000_000.0


def _beat(age: float, connected: bool = True) -> str:
    return json.dumps({"ts": NOW - age, "mqtt_connected": connected})


def test_fresh_connected_heartbeat_is_ok() -> None:
    assert heartbeat_check(_beat(5), NOW).ok


def test_missing_heartbeat_means_the_worker_is_down() -> None:
    check = heartbeat_check(None, NOW)
    assert not check.ok
    assert "not running" in check.detail


def test_stale_heartbeat_fails() -> None:
    assert not heartbeat_check(_beat(HEARTBEAT_MAX_AGE_SECONDS + 1), NOW).ok


def test_worker_without_the_broker_fails() -> None:
    check = heartbeat_check(_beat(5, connected=False), NOW)
    assert not check.ok
    assert "MQTT" in check.detail


def test_unreadable_heartbeat_fails() -> None:
    assert not heartbeat_check("not json", NOW).ok


def test_stream_backlog_within_limit_is_ok() -> None:
    assert stream_check([{"name": "telemetry-writer", "pending": 10, "lag": 5}]).ok


def test_stream_backlog_over_limit_fails() -> None:
    assert not stream_check([{"name": "telemetry-writer", "pending": 40_000, "lag": 20_000}]).ok


def test_no_writer_group_yet_is_ok() -> None:
    assert stream_check([]).ok


def test_heartbeat_payload_reports_connection_and_idle_time() -> None:
    worker._mqtt_connected = True
    worker._last_message_at = 100.0
    try:
        beat = json.loads(worker.heartbeat_payload(NOW, 112.5))
    finally:
        worker._mqtt_connected = False
        worker._last_message_at = None
    assert beat == {"ts": NOW, "mqtt_connected": True, "seconds_since_last_message": 12.5}

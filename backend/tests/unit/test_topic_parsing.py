"""Unit tests for app.ingestion.service.parse_topic — pure, no DB."""

from app.ingestion.service import ParsedTopic, parse_topic


def test_valid_topic_parses() -> None:
    assert parse_topic("acme/sensor-1/temperature") == ParsedTopic(
        tenant_slug="acme", device_slug="sensor-1", metric="temperature"
    )


def test_wrong_segment_count_rejected() -> None:
    assert parse_topic("acme/sensor-1") is None
    assert parse_topic("acme/sensor-1/temperature/extra") is None
    assert parse_topic("acme") is None


def test_empty_segment_rejected() -> None:
    assert parse_topic("acme//temperature") is None
    assert parse_topic("/sensor-1/temperature") is None
    assert parse_topic("acme/sensor-1/") is None


def test_unicode_segments_parse() -> None:
    assert parse_topic("acmé/sénsor/tempераture") == ParsedTopic(
        tenant_slug="acmé", device_slug="sénsor", metric="tempераture"
    )

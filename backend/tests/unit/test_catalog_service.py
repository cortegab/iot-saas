"""Unit tests for app.catalog.service's pure metric-normalization helpers —
no DB. `_normalize_metrics` is what stands between a tenant-authored catalog
entry and the device-health wire contract (CLAUDE.md §4): "status"/"config"
must never be usable as a real metric key, or a status/config message would
be indistinguishable from telemetry on the wire (see app.ingestion.service's
RESERVED_METRIC_STATUS and app.worker's handle_message routing).
"""

import pytest

from app.catalog.service import ReservedMetricKeyError, _normalize_metrics


@pytest.mark.parametrize("reserved", ["status", "config", "Status", "CONFIG", " status "])
def test_explicit_reserved_key_is_rejected(reserved: str) -> None:
    with pytest.raises(ReservedMetricKeyError):
        _normalize_metrics([{"name": "Anything", "key": reserved}])


def test_auto_derived_key_colliding_with_reserved_word_is_rejected() -> None:
    """A metric named literally "Status" with no explicit key slugifies to
    "status" — must be rejected exactly like an explicit collision, not
    silently disambiguated the way an ordinary auto-derived collision would be.
    """
    with pytest.raises(ReservedMetricKeyError):
        _normalize_metrics([{"name": "Status"}])


def test_non_reserved_keys_pass_through_unaffected() -> None:
    normalized = _normalize_metrics([{"name": "Temperature", "key": "temperature"}])
    assert normalized[0]["key"] == "temperature"

"""Unit tests for app.health.service's pure staleness-bound derivation — no
DB. This is what health_monitor_loop feeds into
app.rules.service.reload_staleness_thresholds, so it directly controls when
the hot path's evaluators.py treats a cached reading as stale.
"""

from app.health.service import _ON_CHANGE_MAX_AGE_SECONDS, _derive_max_age
from app.rules.service import DEFAULT_STALE_METRIC_AGE_SECONDS


def test_periodic_with_interval_uses_multiplier() -> None:
    assert _derive_max_age("periodic", 30) == 90


def test_streaming_with_interval_uses_multiplier() -> None:
    assert _derive_max_age("streaming", 5) == 15


def test_periodic_with_no_interval_falls_back_to_default() -> None:
    assert _derive_max_age("periodic", None) == DEFAULT_STALE_METRIC_AGE_SECONDS


def test_on_change_ignores_interval_and_uses_generous_ceiling() -> None:
    """on_change has no fixed cadence — see the module docstring's note on
    the open product question (device-level liveness fallback, not yet
    wired into the evaluator snapshot). A generous fixed ceiling stands in
    for now so an on_change metric isn't spuriously flagged stale.
    """
    assert _derive_max_age("on_change", 30) == _ON_CHANGE_MAX_AGE_SECONDS
    assert _derive_max_age("on_change", None) == _ON_CHANGE_MAX_AGE_SECONDS

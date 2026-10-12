"""The batched telemetry writer's flush decision (worker._should_flush) —
pure, no Redis or DB."""

from app.worker import _should_flush


def test_flushes_a_full_batch_immediately() -> None:
    assert _should_flush(500, 0.0, batch_size=500, interval_s=1.0)


def test_flushes_once_the_oldest_row_has_waited_an_interval() -> None:
    # A steady trickle never leaves Redis idle; rows must still be stored
    # about once per interval, not every `batch_size` readings.
    assert _should_flush(3, 1.0, batch_size=500, interval_s=1.0)


def test_waits_while_the_oldest_row_is_fresh() -> None:
    assert not _should_flush(3, 0.4, batch_size=500, interval_s=1.0)


def test_nothing_to_flush_when_empty() -> None:
    assert not _should_flush(0, 10.0, batch_size=500, interval_s=1.0)

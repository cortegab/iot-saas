"""The backend's words in Spanish (DESIGN.md §11a)."""

import re

from app.i18n import locale_from_header, normalize, t, translate_detail
from app.i18n.messages import EN, ERRORS_ES, ES
from app.push.sender import compose


def test_catalogs_have_the_same_keys_and_placeholders() -> None:
    assert set(EN) == set(ES)
    for key in EN:
        names = lambda s: set(re.findall(r"\{(\w+)\}", s))
        assert names(ES[key]) <= names(EN[key]), key


def test_locale_from_header_and_normalize() -> None:
    assert locale_from_header("es-MX,es;q=0.9,en;q=0.8") == "es"
    assert locale_from_header("fr-FR, en;q=0.5") == "en"
    assert locale_from_header("en;q=0.4, es-AR;q=0.9") == "es"
    assert locale_from_header(None) == "en"
    assert normalize("es_AR") == "es"
    assert normalize(None) == "en"


def test_t_fills_and_falls_back() -> None:
    assert t("es", "push.device_offline", device="Bomba") == "Bomba se desconectó"
    assert t("fr", "push.newAlert") == "New alert"
    assert t("es", "no.such.key") == "no.such.key"


def test_error_details_translate_only_when_listed() -> None:
    assert translate_detail("es", "Device not found") == "No se encontró el dispositivo"
    assert translate_detail("en", "Device not found") == "Device not found"
    assert (
        translate_detail("es", "Something specific about pump1") == "Something specific about pump1"
    )
    assert all(v.strip() for v in ERRORS_ES.values())


def test_push_titles_follow_the_owner_language() -> None:
    common = {
        "notification_id": __import__("uuid").uuid4(),
        "tenant_id": __import__("uuid").uuid4(),
        "kind": "device_offline",
        "severity": "warning",
        "device_id": None,
        "rule_id": None,
        "device_name": "Pump house",
        "rule_name": None,
    }
    assert compose(**common)["notification"]["title"] == "Pump house went offline"
    assert compose(**common, locale="es")["notification"]["title"] == "Pump house se desconectó"


def test_rule_default_notification_carries_keys_and_values() -> None:
    import uuid
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from app.rules.evaluators import MetricValue, SignalKey
    from app.rules.service import _default_message_i18n

    dev = str(uuid.uuid4())
    leaf = {
        "kind": "leaf",
        "device_id": dev,
        "metric": "temp",
        "operator": ">",
        "rhs": {"source": "static", "value": 30},
    }
    rule = SimpleNamespace(condition=leaf, trigger={"type": "metric"}, name="Hot")
    snap = {SignalKey(dev, "temp"): MetricValue(31.5, datetime.now(UTC))}
    out = _default_message_i18n(rule, snap, "fire")  # type: ignore[arg-type]
    assert out["message"]["key"] == "rule.fired"
    assert out["message"]["params"]["condition"]["current"] == 31.5
    cleared = _default_message_i18n(rule, snap, "clear")  # type: ignore[arg-type]
    assert cleared["message"]["key"] == "rule.cleared"
    status = SimpleNamespace(
        condition=None, trigger={"type": "device_status", "transition": "connected"}, name="X"
    )
    assert _default_message_i18n(status, {}, "fire")["message"]["key"] == "rule.deviceConnected"  # type: ignore[arg-type]

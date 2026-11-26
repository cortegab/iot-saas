"""The backend's words in each language (DESIGN.md §11a): emails, push
titles and error messages people read. The web and app carry their own
catalog (@iodriven/shared/i18n); this one covers what the server writes.

`t(locale, key, **params)` fills "{name}" placeholders; a key missing from
a language falls back to English. `locale_from_header` reads Accept-Language
the way the apps send it (the language on screen).
"""

from typing import Literal

from app.i18n.messages import EN, ES

Locale = Literal["en", "es"]
LOCALES: tuple[Locale, ...] = ("en", "es")
_CATALOGS: dict[Locale, dict[str, str]] = {"en": EN, "es": ES}


def normalize(value: str | None) -> Locale:
    """A stored or sent language, or English."""
    base = (value or "").strip().lower().replace("_", "-").split("-")[0]
    return "es" if base == "es" else "en"


def locale_from_header(header: str | None) -> Locale:
    """The first language we speak in an Accept-Language header, by quality;
    English when none."""
    if not header:
        return "en"
    ranked: list[tuple[float, int, str]] = []
    for i, part in enumerate(header.split(",")):
        tag, _, rest = part.strip().partition(";")
        q = 1.0
        if rest.strip().startswith("q="):
            try:
                q = float(rest.strip()[2:])
            except ValueError:
                q = 0.0
        if tag and tag != "*" and q > 0:
            ranked.append((-q, i, tag))
    for _, _, tag in sorted(ranked):
        base = tag.lower().split("-")[0]
        if base in LOCALES:
            return normalize(base)
    return "en"


def t(locale: str | None, key: str, **params: object) -> str:
    """A message in `locale` (else English, else the key), filled."""
    loc = normalize(locale)
    text = _CATALOGS[loc].get(key) or EN.get(key) or key
    for name, value in params.items():
        text = text.replace("{" + name + "}", str(value))
    return text


def translate_detail(locale: str | None, detail: str) -> str:
    """An API error message in `locale`: the fixed English messages have a
    translation (messages.ERRORS); anything else stays as written."""
    if normalize(locale) == "en":
        return detail
    from app.i18n.messages import ERRORS_ES

    return ERRORS_ES.get(detail, detail)

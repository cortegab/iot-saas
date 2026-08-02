"""hash_secret/verify_secret are literal aliases of these (see auth/service.py),
so testing them separately would cover the same code path twice — no separate
test_secret_hashing.py.
"""

from app.auth.service import hash_password, verify_password


def test_round_trip() -> None:
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_wrong_password_rejected() -> None:
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong password", hashed) is False


def test_malformed_hash_rejected() -> None:
    assert verify_password("anything", "not-a-real-argon2-hash") is False

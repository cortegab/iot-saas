import uuid
from datetime import UTC, datetime, timedelta

import jwt as pyjwt
import pytest

from app.auth.service import InvalidAccessTokenError, create_access_token, decode_access_token
from app.config import settings


def test_round_trip() -> None:
    user_id = uuid.uuid4()
    token = create_access_token(user_id)
    assert decode_access_token(token) == user_id


def test_wrong_signature_rejected() -> None:
    token = create_access_token(uuid.uuid4())
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(InvalidAccessTokenError):
        decode_access_token(tampered)


def test_malformed_token_rejected() -> None:
    with pytest.raises(InvalidAccessTokenError):
        decode_access_token("not-a-jwt")


def test_expired_token_rejected() -> None:
    now = datetime.now(UTC)
    payload = {
        "sub": str(uuid.uuid4()),
        "type": "access",
        "iat": now - timedelta(minutes=20),
        "exp": now - timedelta(minutes=5),
        "jti": str(uuid.uuid4()),
    }
    token = pyjwt.encode(
        payload, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm
    )
    with pytest.raises(InvalidAccessTokenError):
        decode_access_token(token)


def test_wrong_token_type_rejected() -> None:
    now = datetime.now(UTC)
    payload = {
        "sub": str(uuid.uuid4()),
        "type": "refresh",  # not "access" — e.g. a refresh token used where an access token belongs
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "jti": str(uuid.uuid4()),
    }
    token = pyjwt.encode(
        payload, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm
    )
    with pytest.raises(InvalidAccessTokenError):
        decode_access_token(token)

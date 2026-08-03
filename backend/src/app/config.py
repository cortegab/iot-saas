"""Application configuration, loaded from the environment via pydantic-settings.

This is the single source of truth for connection details shared by the API
server and the ingestion worker.
"""

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL + TimescaleDB — admin/migration URL (role `iot`, superuser).
    # Read only by alembic/env.py. The running app never holds superuser credentials.
    database_url: str = "postgresql+asyncpg://iot:iot_dev_password@timescaledb:5432/iot"

    # PostgreSQL + TimescaleDB — runtime URL (role `iot_app`, NOSUPERUSER NOBYPASSRLS).
    # This is what app/db.py's engine actually uses, so Row-Level Security policies
    # apply unconditionally. See CLAUDE.md §8 for the one-time role bootstrap.
    app_database_url: str = "postgresql+asyncpg://iot_app:iot_app_dev_password@timescaledb:5432/iot"

    # Redis (cache, streams, pub/sub).
    redis_url: str = "redis://redis:6379/0"

    # EMQX / MQTT broker.
    mqtt_host: str = "emqx"
    mqtt_port: int = 1883

    # Auth (JWT access + refresh tokens).
    jwt_secret_key: SecretStr = SecretStr("dev-only-change-me")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    # EMQX HTTP auth/authz callbacks (app/ingestion/router.py) — shared secret so
    # only EMQX can call them, not arbitrary traffic reaching the api container.
    emqx_auth_shared_secret: SecretStr = SecretStr("dev-only-change-me")

    # The worker's own MQTT identity. Not a row in `devices` — a fixed system
    # credential with subscribe-only access across every tenant's telemetry
    # topics, special-cased in the EMQX auth callbacks.
    mqtt_worker_username: str = "__worker__"
    mqtt_worker_password: SecretStr = SecretStr("dev-only-change-me")

    # Storage-path batched writer (app/worker.py) tuning: flush whichever comes
    # first — batch size or flush interval.
    telemetry_batch_size: int = 500
    telemetry_flush_interval_ms: int = 1000


settings = Settings()

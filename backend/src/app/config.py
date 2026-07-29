"""Application configuration, loaded from the environment via pydantic-settings.

This is the single source of truth for connection details shared by the API
server and the ingestion worker.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL + TimescaleDB (async driver).
    database_url: str = "postgresql+asyncpg://iot:iot_dev_password@timescaledb:5432/iot"

    # Redis (cache, streams, pub/sub).
    redis_url: str = "redis://redis:6379/0"

    # EMQX / MQTT broker.
    mqtt_host: str = "emqx"
    mqtt_port: int = 1883


settings = Settings()

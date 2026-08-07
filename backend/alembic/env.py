import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine, async_engine_from_config

from app.api_keys import models as api_keys_models  # noqa: F401

# Import every module's models here so Base.metadata is fully populated before
# target_metadata is read below. Add one import line whenever a new module
# gains a models.py.
from app.auth import models as auth_models  # noqa: F401
from app.commands import models as commands_models  # noqa: F401
from app.config import settings
from app.db import Base
from app.devices import models as devices_models  # noqa: F401
from app.notifications import models as notifications_models  # noqa: F401
from app.rules import models as rules_models  # noqa: F401
from app.tenants import models as tenants_models  # noqa: F401

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    # Allow an explicit override (used by the test suite to point Alembic at
    # iot_test without touching env vars). Otherwise use the admin/migration URL
    # (role `iot`) — never app_database_url (role `iot_app`), which lacks the
    # DDL/CREATE POLICY privileges migrations need.
    return config.get_main_option("sqlalchemy.url") or settings.database_url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = AsyncEngine(
        async_engine_from_config(
            {"sqlalchemy.url": get_url()},
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
        ).sync_engine
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

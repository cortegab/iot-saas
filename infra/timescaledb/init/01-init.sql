-- Runs once, on first initialization of an empty data volume
-- (mounted into /docker-entrypoint-initdb.d). The TimescaleDB image already
-- enables the extension in the default database, but we assert it explicitly so
-- the intent is documented and the setup is image-agnostic.
CREATE EXTENSION IF NOT EXISTS timescaledb;

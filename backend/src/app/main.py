"""FastAPI application factory.

Skeleton for Phase 0/1 — exposes health/root endpoints so the container boots,
serves OpenAPI at /docs, and gives the frontend something to call. Real modules
(auth, tenants, devices, ...) are added per PLAN.md.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api_keys.router import router as api_keys_router
from app.auth.router import router as auth_router
from app.commands.router import router as commands_router
from app.devices.router import router as devices_router
from app.ingestion.router import router as ingestion_router
from app.logging_config import configure_logging
from app.rules.router import router as rules_router
from app.telemetry.router import router as telemetry_router
from app.tenants.router import router as tenants_router

configure_logging()

app = FastAPI(title="iot-saas API", version="0.0.1")

# Dev-only: allow the local Next.js frontend to call the API from the browser.
# Phase 4 tightens this to explicit origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(tenants_router)
app.include_router(devices_router)
app.include_router(api_keys_router)
app.include_router(telemetry_router)
app.include_router(ingestion_router)
app.include_router(rules_router)
app.include_router(commands_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "iot-saas", "docs": "/docs"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

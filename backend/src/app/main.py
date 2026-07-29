"""FastAPI application factory.

Skeleton for Phase 0/1 — exposes health/root endpoints so the container boots,
serves OpenAPI at /docs, and gives the frontend something to call. Real modules
(auth, tenants, devices, ...) are added per PLAN.md.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="iot-saas API", version="0.0.1")

# Dev-only: allow the local Next.js frontend to call the API from the browser.
# Phase 4 tightens this to explicit origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "iot-saas", "docs": "/docs"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

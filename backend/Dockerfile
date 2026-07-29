# Development image for the FastAPI backend (api + worker share this image).
# Source is bind-mounted at runtime for hot reload; the virtualenv lives outside
# /app so the bind mount does not shadow it.
FROM python:3.12-slim

# uv manages dependencies and the virtualenv.
RUN pip install --no-cache-dir uv

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# Install dependencies first for layer caching. Only the manifests are copied,
# so a source change doesn't invalidate the dependency layer.
COPY pyproject.toml ./
COPY uv.lock* ./
RUN uv sync --no-install-project

# App source (overlaid by the bind mount in compose, present for standalone runs).
COPY . .

EXPOSE 8000

# Overridden per service in docker-compose.yml (api runs uvicorn, worker runs the module).
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

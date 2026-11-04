# Development image for the Next.js frontend. Built from the repo root (the
# pnpm workspace, root .dockerignore). Source is bind-mounted at runtime; both
# node_modules folders (the workspace root's and frontend's links into it) use
# volumes in compose so the bind mounts do not shadow the installed deps.
FROM node:20-alpine

WORKDIR /repo

# Install dependencies first for layer caching. Pin pnpm via the package.json
# packageManager field — corepack's default pnpm is incompatible with Node 20.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
    && pnpm install --frozen-lockfile --filter "iot-saas-frontend..."

COPY frontend frontend
WORKDIR /repo/frontend

EXPOSE 3000

CMD ["pnpm", "dev"]

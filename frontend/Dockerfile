# Development image for the Next.js frontend.
# Source is bind-mounted at runtime; node_modules uses an anonymous volume in
# compose so the bind mount does not shadow the installed dependencies.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for layer caching. Pin pnpm via the package.json
# packageManager field — corepack's default pnpm is incompatible with Node 20.
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm install

COPY . .

EXPOSE 3000

CMD ["pnpm", "dev"]

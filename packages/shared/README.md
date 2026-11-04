# @iodriven/shared

What the web app (`frontend/`) and the mobile app (`mobile/`) share, as TypeScript source (no
build step: Next.js compiles it through `transpilePackages`, Metro compiles it directly).

- `src/api.ts`: the API types, **generated** from the backend's OpenAPI schema. Never edit by
  hand; run `pnpm --filter @iodriven/shared codegen` with the API running (CLAUDE.md §8).
- Pure helpers, one file each (`src/time-ago.ts`, …): no DOM, no React, no I/O. `tsc` here runs
  without the DOM library, so a helper that uses one fails `pnpm --filter @iodriven/shared typecheck`.

Import with the file name: `import { timeAgo } from "@iodriven/shared/time-ago"`. A helper moved here
from `frontend/src/lib/` leaves a one-line re-export at its old path, so web imports don't change.

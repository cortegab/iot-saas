import path from "node:path";
import { fileURLToPath } from "node:url";

/** The pnpm workspace root (pnpm-workspace.yaml): dependencies are installed
 * there and shared code lives in packages/, both outside frontend/. */
const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained build (server + only the node_modules it actually needs)
  // for the production Docker image — see frontend/Dockerfile.prod. Has no
  // effect on `next dev`. Traced from the workspace root, so the output
  // mirrors the repo: .next/standalone/frontend/server.js.
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  // packages/shared ships TypeScript source (no build step).
  transpilePackages: ["@iodriven/shared"],
  // Dev only: the static-route badge sits bottom-left, over the phone tab bar
  // (DESIGN.md §12: nothing floating covers content), so it's off.
  devIndicators: { appIsrStatus: false },
  // Routes moved to the demo G structure (docs/design/DESIGN.md §4); old URLs
  // keep working for bookmarks and links in sent notification emails.
  async redirects() {
    return [
      { source: "/devices/templates", destination: "/templates", permanent: false },
      { source: "/devices/templates/:path*", destination: "/templates/:path*", permanent: false },
      { source: "/settings/organization", destination: "/settings", permanent: false },
      { source: "/settings/alerts", destination: "/settings#alerts", permanent: false },
      { source: "/settings/users", destination: "/members", permanent: false },
      { source: "/settings/roles", destination: "/members", permanent: false },
      { source: "/settings/tokens", destination: "/keys", permanent: false },
      // Failed deliveries became a state of the Rules list (DESIGN.md §6).
      { source: "/rules/failed-actions", destination: "/rules?state=failed", permanent: false },
    ];
  },
};

export default nextConfig;

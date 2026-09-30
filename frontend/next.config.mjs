/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained build (server + only the node_modules it actually needs)
  // for the production Docker image — see frontend/Dockerfile.prod. Has no
  // effect on `next dev`.
  output: "standalone",
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
    ];
  },
};

export default nextConfig;

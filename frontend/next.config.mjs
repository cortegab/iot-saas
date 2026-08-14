/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained build (server + only the node_modules it actually needs)
  // for the production Docker image — see frontend/Dockerfile.prod. Has no
  // effect on `next dev`.
  output: "standalone",
};

export default nextConfig;

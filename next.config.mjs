/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The AI helpers read the docs at runtime, so ship them with the server functions.
  outputFileTracingIncludes: { "/api/agent": ["./content/docs/**/*"] },
  // The vendored OpenCtrl kit (src/lib/mcp-kit) uses ESM-style "./x.js" imports for its .ts files.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
export default nextConfig;

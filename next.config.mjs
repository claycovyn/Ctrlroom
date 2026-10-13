/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    // Names this build for the service worker (public/sw.js?v=…): a new deploy is a new worker and new caches.
    NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || String(Date.now()),
  },
  async headers() {
    return [
      {
        // Browsers must always check for a new worker; it decides what else is cached.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      { source: "/sounds/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
      { source: "/brand/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
    ];
  },
  // The AI helpers read the docs at runtime, so ship them with the server functions.
  outputFileTracingIncludes: { "/api/agent": ["./content/docs/**/*"] },
  // The vendored OpenCtrl kit (src/lib/mcp-kit) uses ESM-style "./x.js" imports for its .ts files.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
export default nextConfig;

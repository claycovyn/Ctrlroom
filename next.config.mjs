/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The AI helpers read the docs at runtime, so ship them with the server functions.
  outputFileTracingIncludes: { "/api/agent": ["./content/docs/**/*"] },
};
export default nextConfig;

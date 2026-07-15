import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Tewiz admin runs on :3001 to avoid clashing with the API on :3000.
  // All API calls go to NEXT_PUBLIC_API_URL.
  reactStrictMode: true,
  // Strip console.* from the production bundle (keep warn/error for real
  // incidents) so debug logs don't ship to admins' browsers or bloat the JS.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['warn', 'error'] } : false,
  },
  // Source maps in prod expose the full readable source to anyone with the
  // browser devtools and roughly double the build output — off for an internal
  // dashboard where we debug from the dev build instead.
  productionBrowserSourceMaps: false,
};

export default nextConfig;

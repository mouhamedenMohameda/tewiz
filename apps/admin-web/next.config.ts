import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Tewiz admin runs on :3001 to avoid clashing with the API on :3000.
  // All API calls go to NEXT_PUBLIC_API_URL.
  reactStrictMode: true,
};

export default nextConfig;

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['telegram'],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;

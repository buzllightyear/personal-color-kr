import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow images from any HTTPS source for preview URLs returned by fal.ai
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;

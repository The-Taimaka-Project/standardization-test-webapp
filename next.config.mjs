/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // node-postgres bundles an optional 'pg-native' that we don't use; mark
  // it external so webpack stops trying to resolve it.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'pg-native'];
    }
    return config;
  },
};

export default nextConfig;

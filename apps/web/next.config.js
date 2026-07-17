/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@stoppage/sdk", "@stoppage/txline"],
  // Next 16 builds with Turbopack by default; an empty turbopack config
  // acknowledges that so the webpack block below only applies to --webpack
  // builds (same approach pir8 landed on).
  turbopack: {},
  webpack: (config) => {
    // wallet-adapter pulls in optional node deps that don't exist in the browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
    };
    return config;
  },
};

module.exports = nextConfig;

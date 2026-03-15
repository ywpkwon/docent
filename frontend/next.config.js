/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // PDF.js worker needs to be served as a static file
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Required for SharedArrayBuffer (used by some PDF.js features)
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

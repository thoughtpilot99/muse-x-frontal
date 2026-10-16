import type { NextConfig } from "next";

// Local single-user app backed by SQLite: every page reads live data at request time.
const nextConfig: NextConfig = {
  experimental: {
    // Slack export ZIPs and transcript batches are bigger than the 1 MB default.
    serverActions: { bodySizeLimit: "60mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

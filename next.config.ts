import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  // The scoring API reads data/ from disk at runtime; make sure it ships with the serverless bundle.
  outputFileTracingIncludes: {
    "/api/routes": ["./data/**/*"],
    "/api/timeline": ["./data/**/*"],
    "/api/bus": ["./data/bus.json.gz"],
    "/api/meta": ["./data/meta.json"],
  },
  serverExternalPackages: ["opening_hours"],
};

export default config;

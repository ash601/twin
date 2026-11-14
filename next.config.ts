import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Your data folder (my-twin/) is read at runtime, never bundled.
  outputFileTracingExcludes: { "*": ["./my-twin/**"] },
};

export default nextConfig;

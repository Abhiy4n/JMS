import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // The CLI checker can lose its captured `tsc --showConfig` output on newer
    // Node releases, leaving an incomplete production build with no CSS assets.
    // Use Next's in-process TypeScript API so builds complete deterministically.
    useTypeScriptCli: false,
    webpackBuildWorker: false,
  },
};

export default nextConfig;

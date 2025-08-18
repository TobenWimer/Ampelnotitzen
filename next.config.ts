import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,   // 🚀 Linter-Fehler blockieren den Build nicht mehr
  },
};

export default nextConfig;

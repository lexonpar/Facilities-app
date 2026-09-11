import type { NextConfig } from "next";
import { validateIsolatedEnvironment } from "./supabase/functions/_shared/environment";

// NEXT_PUBLIC_SUPABASE_URL is frozen into client storage/Realtime code at build.
// Reject a mixed environment before producing or serving those client bundles.
validateIsolatedEnvironment(process.env, "web");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;

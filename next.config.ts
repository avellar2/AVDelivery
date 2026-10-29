import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
let productImagePatterns: { protocol: "http" | "https"; hostname: string; pathname: string }[] = [];

if (supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      productImagePatterns = [
        {
          protocol: parsed.protocol === "http:" ? "http" : "https",
          hostname: parsed.hostname,
          pathname: "/storage/v1/object/public/product-images/**",
        },
      ];
    }
  } catch {
    productImagePatterns = [];
  }
}

const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: productImagePatterns,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

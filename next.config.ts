import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(self), payment=(), usb=()",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

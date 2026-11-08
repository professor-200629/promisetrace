import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// PayPal JS SDK needs its own script, frame and connect origins.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://www.paypal.com https://*.paypal.com https://www.paypalobjects.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.paypal.com https://www.paypalobjects.com",
  "font-src 'self' data:",
  "frame-src https://*.paypal.com https://www.sandbox.paypal.com",
  `connect-src 'self' https://*.paypal.com https://www.sandbox.paypal.com${isDev ? " ws:" : ""}`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client", "@prisma/adapter-libsql"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

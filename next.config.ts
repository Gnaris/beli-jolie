import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "sharp", "exceljs"],

  // Expose R2_PUBLIC_URL to client components as NEXT_PUBLIC_R2_URL
  env: {
    NEXT_PUBLIC_R2_URL: process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "",
  },

  // ─── Image optimization (78k products = lots of images) ───
  images: {
    minimumCacheTTL: 2592000, // 30 days — product images are hashed/unique
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: "https" as const,
        hostname: "**.r2.dev",
      },
      {
        protocol: "https" as const,
        hostname: "static.parisfashionshops.com",
      },
      {
        protocol: "https" as const,
        hostname: "cdn.parisfashionshops.com",
      },
    ],
  },

  // ─── Performance ───
  compress: true,
  poweredByHeader: false,

  // ─── Rewrite /uploads/* to R2 (so existing DB paths work as image URLs) ───
  async rewrites() {
    const r2PublicUrl = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL;
    if (!r2PublicUrl) return [];
    return [
      {
        source: "/uploads/:path*",
        destination: `${r2PublicUrl}/uploads/:path*`,
      },
    ];
  },

  // ─── Security & performance headers ───
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://*.stripe.com https://static.parisfashionshops.com https://cdn.parisfashionshops.com ${process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || ""}`,
      "font-src 'self'",
      "connect-src 'self' https://api.stripe.com https://api-free.deepl.com https://api.deepl.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      {
        // Cache static assets aggressively
        source: "/uploads/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);

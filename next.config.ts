import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "sharp", "exceljs", "playwright", "imapflow"],

  // Lots d'images d'import produits (jusqu'à 50 fichiers par requête).
  // Défaut Next.js = 10 Mo → l'upload plante en « Failed to fetch ».
  experimental: {
    proxyClientMaxBodySize: "300mb",
    // Server Actions ont leur propre limite (défaut 1 Mo) qui bloque les
    // uploads d'images via server actions (logo, bannière, photos onboarding).
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },

  // ─── Image optimization ───
  images: {
    minimumCacheTTL: 2592000, // 30 days — product images are hashed/unique
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
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

  // Prevent file tracing from scanning all 52k+ files in public/
  outputFileTracingExcludes: {
    "/api/admin/products/import/draft/[id]": ["./public/**"],
    "/api/admin/products/import/images/variants": ["./public/**"],
  },

  // Forcer l'inclusion du modèle XLSX officiel d'Ankorstore dans le bundle de
  // l'API d'export — il sert de base au générateur (`generate-ankorstore.ts`),
  // sans quoi Next.js ne le copie pas dans `.next/standalone` ou le tracing
  // serverless. Sans ça, l'export échouerait en prod avec ENOENT.
  outputFileTracingIncludes: {
    "/api/admin/marketplace-export": [
      "./lib/marketplace-excel/templates/ankorstore-template.xlsx",
    ],
  },

  // ─── Security & performance headers ───
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.stripe.com https://static.parisfashionshops.com https://cdn.parisfashionshops.com https://img.ankorstore.com",
      "font-src 'self'",
      "connect-src 'self' https://api.stripe.com https://wholesaler-api.parisfashionshops.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://mail.beliandjolie.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
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

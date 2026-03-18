import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
  images: {
    minimumCacheTTL: 2592000, // 30 days — product images are hashed/unique
  },
};

export default withNextIntl(nextConfig);

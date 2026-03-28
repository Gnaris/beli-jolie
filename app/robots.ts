import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXTAUTH_URL || "https://example.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/",
          "/espace-pro/",
          "/panier/",
          "/commandes/",
          "/maintenance",
          "/connexion",
          "/inscription",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

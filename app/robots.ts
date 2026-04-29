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
          "/favoris",
          "/maintenance",
          "/connexion",
          "/inscription",
          "/mot-de-passe-oublie",
          "/reinitialiser-mot-de-passe",
          "/catalogue/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

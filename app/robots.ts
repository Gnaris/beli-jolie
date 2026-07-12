import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Multi-tenant : le sitemap doit pointer sur le domaine du tenant qui
  // reçoit la requête (`Host:`), pas sur NEXTAUTH_URL qui est fixée à BJ.
  let baseUrl = process.env.NEXTAUTH_URL || "https://example.com";
  try {
    const h = await headers();
    const host = h.get("host");
    if (host) baseUrl = `https://${host}`;
  } catch {
    // hors requête (build) : fallback env
  }

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

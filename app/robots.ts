import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { VALID_LOCALES } from "@/i18n/locales";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Multi-tenant : le sitemap doit pointer sur le domaine du tenant qui
  // reçoit la requête (`Host:`), pas sur NEXTAUTH_URL qui est fixée à BJ.
  let baseUrl = process.env.NEXTAUTH_URL || "https://example.com";
  try {
    const h = await headers();
    const host = h.get("host");
    if (host) baseUrl = `https://${host.replace(/^www\./, "")}`;
  } catch {
    // hors requête (build) : fallback env
  }

  // Les pages privées existent sous préfixe de langue (/fr/panier, /en/panier…).
  // On bloque donc la forme sans préfixe ET chaque forme préfixée
  // (/fr/panier, /en/panier…). Pas de joker `/*/panier` : il bloquerait aussi
  // une fiche produit dont le slug commence par « panier-… ».
  const privatePaths = [
    "/espace-pro",
    "/panier",
    "/commandes",
    "/favoris",
    "/connexion",
    "/inscription",
    "/mot-de-passe-oublie",
    "/reinitialiser-mot-de-passe",
    "/confirmer-email",
    "/catalogue/",
  ];

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/",
          "/maintenance",
          ...privatePaths,
          ...VALID_LOCALES.flatMap((locale) => privatePaths.map((p) => `/${locale}${p}`)),
        ],
      },
    ],
    // Index des sitemaps (1 fichier par langue) — l'ancien sitemap unique
    // dépassait la limite Google de 50 000 URLs.
    sitemap: `${baseUrl}/sitemap_index.xml`,
  };
}

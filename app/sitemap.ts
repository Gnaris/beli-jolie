import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { VALID_LOCALES } from "@/i18n/locales";

const STATIC_PATHS: { path: string; changeFrequency: "daily" | "weekly" | "monthly" | "yearly"; priority: number }[] = [
  { path: "", changeFrequency: "daily", priority: 1 },
  { path: "/produits", changeFrequency: "daily", priority: 0.9 },
  { path: "/categories", changeFrequency: "weekly", priority: 0.8 },
  { path: "/collections", changeFrequency: "weekly", priority: 0.8 },
  { path: "/nous-contacter", changeFrequency: "monthly", priority: 0.5 },
  { path: "/cgu", changeFrequency: "yearly", priority: 0.3 },
  { path: "/cgv", changeFrequency: "yearly", priority: 0.3 },
  { path: "/confidentialite", changeFrequency: "yearly", priority: 0.3 },
  { path: "/cookies", changeFrequency: "yearly", priority: 0.3 },
  { path: "/mentions-legales", changeFrequency: "yearly", priority: 0.3 },
];

function buildLanguageMap(baseUrl: string, path: string): Record<string, string> {
  const langs: Record<string, string> = { "x-default": `${baseUrl}/fr${path}` };
  for (const locale of VALID_LOCALES) {
    langs[locale] = `${baseUrl}/${locale}${path}`;
  }
  return langs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXTAUTH_URL || "https://example.com").replace(/\/$/, "");
  const now = new Date();

  // ── Pages statiques : 1 entrée par page (avec alternates pour les 7 locales) ──
  const staticPages: MetadataRoute.Sitemap = STATIC_PATHS.flatMap(({ path, changeFrequency, priority }) =>
    VALID_LOCALES.map((locale) => ({
      url: `${baseUrl}/${locale}${path}`,
      lastModified: now,
      changeFrequency,
      priority,
      alternates: { languages: buildLanguageMap(baseUrl, path) },
    }))
  );

  // ── Produits dynamiques (limite 50k pour rester sous le plafond Google) ──
  const products = await prisma.product.findMany({
    where: { status: "ONLINE" },
    select: { id: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 50000,
  });

  const productPages: MetadataRoute.Sitemap = products.flatMap((p) =>
    VALID_LOCALES.map((locale) => ({
      url: `${baseUrl}/${locale}/produits/${p.id}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
      alternates: { languages: buildLanguageMap(baseUrl, `/produits/${p.id}`) },
    }))
  );

  // ── Collections ──────────────────────────────────────────────────────────
  const collections = await prisma.collection.findMany({
    select: { id: true, updatedAt: true },
  });

  const collectionPages: MetadataRoute.Sitemap = collections.flatMap((c) =>
    VALID_LOCALES.map((locale) => ({
      url: `${baseUrl}/${locale}/collections/${c.id}`,
      lastModified: c.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
      alternates: { languages: buildLanguageMap(baseUrl, `/collections/${c.id}`) },
    }))
  );

  return [...staticPages, ...productPages, ...collectionPages];
}

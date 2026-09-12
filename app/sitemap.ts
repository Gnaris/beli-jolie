import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { VALID_LOCALES, DEFAULT_LOCALE } from "@/i18n/locales";
import { getCurrentTenantId } from "@/lib/tenant";
import { buildProductHandle } from "@/lib/product-url";

const STATIC_PATHS: { path: string; changeFrequency: "daily" | "weekly" | "monthly" | "yearly"; priority: number }[] = [
  { path: "", changeFrequency: "daily", priority: 1 },
  { path: "/produits", changeFrequency: "daily", priority: 0.9 },
  { path: "/categories", changeFrequency: "weekly", priority: 0.8 },
  { path: "/collections", changeFrequency: "weekly", priority: 0.8 },
  { path: "/a-propos", changeFrequency: "monthly", priority: 0.6 },
  { path: "/nous-contacter", changeFrequency: "monthly", priority: 0.5 },
  { path: "/cgu", changeFrequency: "yearly", priority: 0.3 },
  { path: "/cgv", changeFrequency: "yearly", priority: 0.3 },
  { path: "/confidentialite", changeFrequency: "yearly", priority: 0.3 },
  { path: "/cookies", changeFrequency: "yearly", priority: 0.3 },
  { path: "/mentions-legales", changeFrequency: "yearly", priority: 0.3 },
];

function buildLanguageMap(baseUrl: string, path: string): Record<string, string> {
  const langs: Record<string, string> = { "x-default": `${baseUrl}/${DEFAULT_LOCALE}${path}` };
  for (const locale of VALID_LOCALES) {
    langs[locale] = `${baseUrl}/${locale}${path}`;
  }
  return langs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Bind ALS avant Prisma pour que les findMany soient scopés au tenant courant
  // (résolu par le middleware via le Host header). Sans ça, le sitemap contient
  // les produits des 2 boutiques.
  await getCurrentTenantId();
  // Base URL = host courant (multi-tenant), sinon fallback NEXTAUTH_URL.
  let baseUrl = (process.env.NEXTAUTH_URL || "https://example.com").replace(/\/$/, "");
  try {
    const h = await headers();
    const host = h.get("host");
    if (host) baseUrl = `https://${host}`;
  } catch {
    // build time : fallback env
  }
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

  // ── Produits dynamiques ─────────────────────────────────────────────────
  // Plafond Google = 50 000 URLs par sitemap. On a 2 locales (fr, en), donc
  // chaque produit compte pour 2 entrées. Limite à ~24 000 produits pour
  // laisser un peu de marge aux pages statiques et collections.
  const products = await prisma.product.findMany({
    where: { status: "ONLINE" },
    select: { id: true, name: true, reference: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 24000,
  });

  const productPages: MetadataRoute.Sitemap = products.flatMap((p) => {
    const handle = buildProductHandle(p.name, p.reference);
    return VALID_LOCALES.map((locale) => ({
      url: `${baseUrl}/${locale}/produits/${handle}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
      alternates: { languages: buildLanguageMap(baseUrl, `/produits/${handle}`) },
    }));
  });

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

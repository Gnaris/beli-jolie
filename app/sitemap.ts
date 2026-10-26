import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { VALID_LOCALES, DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { getCurrentTenantId, getCurrentTenantSlug } from "@/lib/tenant";
import { buildProductHandle } from "@/lib/product-url";
import { PUBLIC_SELLABLE_COLORS_CLAUSE } from "@/lib/public-product-visibility";

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

// Google refuse un sitemap > 50 000 URLs OU > 50 Mo non compressé.
// L'ancien sitemap unique (5 locales × ~10 000 produits + hreflang) faisait
// 50 290 URLs / 50,7 Mo → erreur « Trop d'URL » dans la Search Console et
// lecture tronquée. On découpe désormais en 1 sitemap par locale :
// /sitemap/fr.xml, /sitemap/en.xml, … référencés par /sitemap_index.xml.
// Plafond de sécurité par fichier (pages statiques + catégories + collections
// incluses) — ~10 000 produits aujourd'hui, marge ×4.
const MAX_PRODUCTS_PER_LOCALE = 45000;

function buildLanguageMap(baseUrl: string, path: string): Record<string, string> {
  const langs: Record<string, string> = { "x-default": `${baseUrl}/${DEFAULT_LOCALE}${path}` };
  for (const locale of VALID_LOCALES) {
    langs[locale] = `${baseUrl}/${locale}${path}`;
  }
  return langs;
}

export async function generateSitemaps() {
  return VALID_LOCALES.map((locale) => ({ id: locale }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const rawId = String(await props.id);
  const locale: Locale = (VALID_LOCALES as readonly string[]).includes(rawId)
    ? (rawId as Locale)
    : DEFAULT_LOCALE;

  // Bind ALS avant Prisma pour que les findMany soient scopés au tenant courant
  // (résolu par le middleware via le Host header). Sans ça, le sitemap contient
  // les produits des 2 boutiques.
  await getCurrentTenantId();
  const tenantSlug = await getCurrentTenantSlug();
  // Base URL = host courant (multi-tenant), sinon fallback NEXTAUTH_URL.
  let baseUrl = (process.env.NEXTAUTH_URL || "https://example.com").replace(/\/$/, "");
  try {
    const h = await headers();
    const host = h.get("host");
    if (host) baseUrl = `https://${host.replace(/^www\./, "")}`;
  } catch {
    // build time : fallback env
  }
  const now = new Date();

  // /qui-sommes-nous existe uniquement sur Beli & Jolie (slug tenant
  // `beliandjolie`), page codée en dur propre à cette boutique. On l'injecte
  // conditionnellement pour qu'Issyma n'expose pas une URL qui renvoie 404.
  const staticPaths =
    tenantSlug === "beliandjolie"
      ? [
          ...STATIC_PATHS,
          { path: "/qui-sommes-nous", changeFrequency: "monthly" as const, priority: 0.6 },
        ]
      : STATIC_PATHS;

  const entry = (
    path: string,
    lastModified: Date,
    changeFrequency: "daily" | "weekly" | "monthly" | "yearly",
    priority: number,
  ): MetadataRoute.Sitemap[number] => ({
    url: `${baseUrl}/${locale}${path}`,
    lastModified,
    changeFrequency,
    priority,
    alternates: { languages: buildLanguageMap(baseUrl, path) },
  });

  // ── Pages statiques ──────────────────────────────────────────────────────
  const staticPages = staticPaths.map(({ path, changeFrequency, priority }) =>
    entry(path, now, changeFrequency, priority),
  );

  // ── Produits ─────────────────────────────────────────────────────────────
  const products = await prisma.product.findMany({
    where: { status: "ONLINE", colors: PUBLIC_SELLABLE_COLORS_CLAUSE },
    select: { name: true, reference: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_PRODUCTS_PER_LOCALE,
  });
  const productPages = products.map((p) =>
    entry(`/produits/${buildProductHandle(p.name, p.reference)}`, p.updatedAt, "weekly", 0.7),
  );

  // ── Collections ──────────────────────────────────────────────────────────
  // URL slugifiée depuis 2026-09-13. Les collections sans slug sont exclues.
  const collections = await prisma.collection.findMany({
    where: { slug: { not: null } },
    select: { slug: true, updatedAt: true },
  });
  const collectionPages = collections.map((c) =>
    entry(`/collections/${c.slug}`, c.updatedAt, "weekly", 0.6),
  );

  // ── Catégories ───────────────────────────────────────────────────────────
  // Uniquement celles avec au moins 1 produit vendable (sinon soft 404).
  const categoriesWithProducts = await prisma.category.findMany({
    where: {
      products: {
        some: { status: "ONLINE", colors: PUBLIC_SELLABLE_COLORS_CLAUSE },
      },
    },
    select: { slug: true },
  });
  const categoryPages = categoriesWithProducts.map((c) =>
    entry(`/categories/${c.slug}`, now, "weekly", 0.8),
  );

  return [...staticPages, ...categoryPages, ...collectionPages, ...productPages];
}

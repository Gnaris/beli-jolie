import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { VALID_LOCALES, type Locale } from "@/i18n/locales";

export interface OrganizationData {
  name: string;
  url: string;
  description: string;
  email?: string | null;
  phone?: string | null;
  address?: {
    street?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
}

export function getSiteUrl(): string {
  const raw = process.env.NEXTAUTH_URL || "https://example.com";
  return raw.replace(/\/$/, "");
}

export function absoluteUrl(path: string): string {
  const base = getSiteUrl();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

/**
 * Construit canonical + alternates hreflang pour une page localisée.
 *
 * @param path - chemin SANS préfixe locale (ex: "/produits/123", "/").
 * @param currentLocale - locale courante de la page (utilisée pour le canonical).
 *                       Si omis, utilise la locale par défaut.
 *
 * Retourne le canonical = URL avec préfixe de la locale courante,
 * et un set d'alternates languages pointant vers chaque variante par locale.
 */
export function buildAlternates(path: string, currentLocale: string = "fr"): {
  canonical: string;
  languages: Record<string, string>;
} {
  const cleanPath = path === "/" ? "" : path;
  const base = getSiteUrl();
  const languages: Record<string, string> = {
    "x-default": `${base}/fr${cleanPath}`,
  };
  for (const locale of VALID_LOCALES) {
    languages[locale] = `${base}/${locale}${cleanPath}`;
  }
  return {
    canonical: `${base}/${currentLocale}${cleanPath}`,
    languages,
  };
}

export const getCachedSeoConfig = unstable_cache(
  async () => {
    const info = await prisma.companyInfo.findFirst();
    return {
      shopName: info?.shopName || info?.name || "Ma Boutique",
      legalName: info?.name || null,
      email: info?.email ?? null,
      phone: info?.phone ?? null,
      address: {
        street: info?.address ?? null,
        city: info?.city ?? null,
        postalCode: info?.postalCode ?? null,
        country: info?.country ?? null,
      },
    };
  },
  ["seo-config"],
  { revalidate: 300, tags: ["company-info"] }
);

export function buildOrganizationSchema(data: OrganizationData) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: data.name,
    description: data.description,
    url: data.url,
  };
  if (data.email || data.phone) {
    schema.contactPoint = {
      "@type": "ContactPoint",
      contactType: "customer support",
      ...(data.email && { email: data.email }),
      ...(data.phone && { telephone: data.phone }),
    };
  }
  if (data.address?.street || data.address?.city) {
    schema.address = {
      "@type": "PostalAddress",
      ...(data.address.street && { streetAddress: data.address.street }),
      ...(data.address.city && { addressLocality: data.address.city }),
      ...(data.address.postalCode && { postalCode: data.address.postalCode }),
      ...(data.address.country && { addressCountry: data.address.country }),
    };
  }
  return schema;
}

export function buildWebsiteSchema(opts: { name: string; url: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: opts.name,
    url: opts.url,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${opts.url}/produits?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export const SUPPORTED_LOCALES: readonly Locale[] = VALID_LOCALES;

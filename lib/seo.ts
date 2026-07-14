import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { VALID_LOCALES, DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";

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

/**
 * URL publique du tenant courant, sans slash final. Multi-tenant : lit le
 * `Host:` header courant plutôt que `NEXTAUTH_URL` (qui est fixée à un unique
 * domaine et servirait le même canonical/OG à toutes les boutiques).
 */
export async function getSiteUrl(): Promise<string> {
  return await getCurrentTenantBaseUrl();
}

export async function absoluteUrl(path: string): Promise<string> {
  const base = await getSiteUrl();
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
export async function buildAlternates(
  path: string,
  currentLocale: string = DEFAULT_LOCALE,
): Promise<{ canonical: string; languages: Record<string, string> }> {
  const cleanPath = path === "/" ? "" : path;
  const base = await getSiteUrl();
  const languages: Record<string, string> = {
    "x-default": `${base}/${DEFAULT_LOCALE}${cleanPath}`,
  };
  for (const locale of VALID_LOCALES) {
    languages[locale] = `${base}/${locale}${cleanPath}`;
  }
  return {
    canonical: `${base}/${currentLocale}${cleanPath}`,
    languages,
  };
}

/**
 * Retourne le seo config du tenant courant.
 * Scope par tenant : les caches unstable_cache et les tags de revalidation
 * portent le tenantId, sinon 2 boutiques partagent les mêmes infos SEO
 * (fuite : email/tel/adresse de la boutique A servis sur la boutique B).
 */
const _seoConfigCache = new Map<string, () => Promise<{ shopName: string; legalName: string | null; email: string | null; phone: string | null; address: { street: string | null; city: string | null; postalCode: string | null; country: string | null } }>>();

export async function getCachedSeoConfig() {
  // Résolution du tenant : ALS d'abord, fallback headers. L'ALS peut être
  // vide si le server component a été scheduled avant que le parent bind.
  let tid = getCurrentTenantIdSync();
  if (!tid) {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      tid = h.get("x-tenant-id");
    } catch {
      // script CLI hors requête
    }
  }
  const finalTid = tid ?? "global";
  let cached = _seoConfigCache.get(finalTid);
  if (!cached) {
    const capturedTenantId = finalTid === "global" ? undefined : finalTid;
    cached = unstable_cache(
      async () => {
        const info = await prisma.companyInfo.findFirst({
          where: capturedTenantId ? { tenantId: capturedTenantId } : undefined,
        });
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
      ["seo-config", finalTid],
      { revalidate: 300, tags: [`company-info:${finalTid}`] },
    );
    _seoConfigCache.set(finalTid, cached);
  }
  return cached();
}

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

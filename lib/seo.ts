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
  /** URL absolue du logo carré (≥112×112 recommandé par Google). */
  logoUrl?: string | null;
  /** Liens vers les profils officiels (Instagram, Facebook, …). Filtrés côté schema. */
  sameAs?: string[];
  /** Note moyenne + nombre d'avis. Injecté seulement si count ≥ 1. */
  aggregateRating?: { ratingValue: number; reviewCount: number } | null;
}

/** Clés SiteConfig utilisées par le SEO — centralisées ici. */
export const SEO_CONFIG_KEYS = {
  logo: "site_logo_url",
  ogImage: "site_og_image_url",
  socials: [
    "social_facebook_url",
    "social_instagram_url",
    "social_pinterest_url",
    "social_tiktok_url",
    "social_youtube_url",
    "social_linkedin_url",
    "social_twitter_url",
  ] as const,
} as const;

export type SocialPlatform = (typeof SEO_CONFIG_KEYS.socials)[number];

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
export interface SeoConfig {
  shopName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  address: { street: string | null; city: string | null; postalCode: string | null; country: string | null };
  /** URL absolue du logo (déjà préfixée par siteUrl si stockée en chemin relatif). */
  logoUrl: string | null;
  /** URL absolue de l'image OG par défaut. `null` = fallback auto (opengraph-image.tsx). */
  ogImageUrl: string | null;
  /** Comptes sociaux non-vides, triés dans l'ordre canonique. */
  socials: string[];
  /** Moyenne + count des CustomerReview APPROVED ; `null` si aucun avis. */
  reviews: { ratingValue: number; reviewCount: number } | null;
}

const _seoConfigCache = new Map<string, () => Promise<SeoConfig>>();

/**
 * Retourne toute la config utilisée par le SEO du tenant courant :
 * infos société + logo/OG + réseaux sociaux + agrégat des avis.
 *
 * Multi-tenant : cache scopé par tenantId (le tid est injecté dans la clé
 * et dans les tags). L'ALS est rebindée dans le callback pour que Prisma
 * scope automatiquement CompanyInfo et CustomerReview.
 */
export async function getCachedSeoConfig(): Promise<SeoConfig> {
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
        const baseWhere = capturedTenantId ? { tenantId: capturedTenantId } : undefined;
        const [info, configs, reviewsAgg] = await Promise.all([
          prisma.companyInfo.findFirst({ where: baseWhere }),
          prisma.siteConfig.findMany({
            where: {
              ...(baseWhere ?? {}),
              key: {
                in: [
                  SEO_CONFIG_KEYS.logo,
                  SEO_CONFIG_KEYS.ogImage,
                  ...SEO_CONFIG_KEYS.socials,
                ],
              },
            },
            select: { key: true, value: true },
          }),
          prisma.customerReview.aggregate({
            where: { ...(baseWhere ?? {}), status: "APPROVED" },
            _avg: { rating: true },
            _count: { _all: true },
          }),
        ]);

        const configMap = new Map(configs.map((c) => [c.key, c.value ?? ""]));
        const socials = SEO_CONFIG_KEYS.socials
          .map((k) => configMap.get(k)?.trim())
          .filter((v): v is string => !!v && /^https?:\/\//i.test(v));

        const reviewCount = reviewsAgg._count._all;
        const ratingRaw = reviewsAgg._avg.rating ?? 0;
        const reviews = reviewCount > 0
          ? { ratingValue: Math.round(Number(ratingRaw) * 10) / 10, reviewCount }
          : null;

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
          logoUrl: configMap.get(SEO_CONFIG_KEYS.logo)?.trim() || null,
          ogImageUrl: configMap.get(SEO_CONFIG_KEYS.ogImage)?.trim() || null,
          socials,
          reviews,
        };
      },
      ["seo-config", finalTid],
      { revalidate: 300, tags: [`company-info:${finalTid}`, `site-config:${finalTid}`, `customer-reviews:${finalTid}`] },
    );
    _seoConfigCache.set(finalTid, cached);
  }
  return cached();
}

/**
 * JSON-LD Organization : identité de la marque pour Google.
 *
 * - `logo` : image carrée ≥112×112, sert de vignette dans les résultats Google.
 * - `sameAs` : profils sociaux officiels (Instagram, Facebook…). Google peut
 *   afficher un carrousel de liens sous la fiche marque.
 * - `aggregateRating` : moyenne des avis clients (étoiles jaunes potentielles
 *   sous le résultat). Non affiché systématiquement par Google.
 */
export function buildOrganizationSchema(data: OrganizationData) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: data.name,
    description: data.description,
    url: data.url,
  };
  if (data.logoUrl) {
    schema.logo = data.logoUrl;
    // `image` = alias reconnu par Google pour le crawler d'images.
    schema.image = data.logoUrl;
  }
  if (data.sameAs && data.sameAs.length > 0) {
    schema.sameAs = data.sameAs;
  }
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
  if (data.aggregateRating && data.aggregateRating.reviewCount > 0) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: data.aggregateRating.ratingValue,
      reviewCount: data.aggregateRating.reviewCount,
      bestRating: 5,
      worstRating: 1,
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

/**
 * Liste explicite des liens principaux du site pour Google.
 * Injecté en JSON-LD sur la page d'accueil. Google s'en sert (entre autres
 * signaux) pour décider quels sitelinks afficher sous le résultat de recherche
 * du site. Pas de garantie d'affichage — mais ça envoie un signal clair.
 */
export function buildSiteNavigationSchema(opts: {
  baseUrl: string;
  locale: string;
  links: Array<{ name: string; path: string }>;
}) {
  const clean = opts.baseUrl.replace(/\/$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: opts.links.map((link, i) => ({
      "@type": "SiteNavigationElement",
      position: i + 1,
      name: link.name,
      url: `${clean}/${opts.locale}${link.path === "/" ? "" : link.path}`,
    })),
  };
}

export const SUPPORTED_LOCALES: readonly Locale[] = VALID_LOCALES;

/**
 * Blocs `hasMerchantReturnPolicy` + `shippingDetails` à injecter dans un
 * `Offer` JSON-LD. Google Search Console signale ces champs manquants sinon
 * (alerte "Fiches de marchand — hasMerchantReturnPolicy / shippingDetails").
 *
 * Valeurs par défaut sensées pour du B2B FR — à faire évoluer côté SiteConfig
 * si la cliente veut affiner par tenant (délais, seuil de gratuité…).
 */
export function buildMerchantOfferExtras() {
  return {
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "FR",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 14,
      returnMethod: "https://schema.org/ReturnByMail",
      returnFees: "https://schema.org/FreeReturn",
    },
    shippingDetails: {
      "@type": "OfferShippingDetails",
      shippingRate: {
        "@type": "MonetaryAmount",
        value: "9.90",
        currency: "EUR",
      },
      shippingDestination: {
        "@type": "DefinedRegion",
        addressCountry: "FR",
      },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: {
          "@type": "QuantitativeValue",
          minValue: 0,
          maxValue: 1,
          unitCode: "DAY",
        },
        transitTime: {
          "@type": "QuantitativeValue",
          minValue: 2,
          maxValue: 5,
          unitCode: "DAY",
        },
      },
    },
  };
}

/**
 * Génère les textes SEO par défaut pour une page catégorie publique
 * (/[locale]/categories/[slug]) quand la cliente n'a rien saisi.
 *
 * La trame se veut correcte pour Google dès la mise en ligne, tout en
 * restant assez générique pour convenir aux 2 tenants (mode et bijoux).
 * La cliente améliore ensuite via l'admin.
 */

export interface CategorySeoFaqItem {
  q: string;
  a: string;
}

export interface CategorySeoContent {
  title: string;
  intro: string;
  secondary: string;
  faq: CategorySeoFaqItem[];
}

interface DefaultsContext {
  categoryName: string;
  shopName: string;
  productCount: number;
  locale: "fr" | "en";
}

/**
 * Construit la trame par défaut à partir du nom de la catégorie.
 * Les champs sont uniquement utilisés en fallback des overrides éditoriaux.
 */
export function buildDefaultCategorySeo(ctx: DefaultsContext): CategorySeoContent {
  const { categoryName, shopName, productCount, locale } = ctx;
  const lowerName = categoryName.toLocaleLowerCase(locale);

  if (locale === "en") {
    return {
      title: `Wholesale ${lowerName} — ${shopName}`,
      intro: `Discover the ${shopName} wholesale selection of ${lowerName} for independent boutiques and concept stores. Professional pricing, accessible minimum order, delivery within 48–72 h across France and Europe.`,
      secondary: `Our ${lowerName} are hand-picked from certified European and Asian manufacturers. Sizes and colours are refreshed every season — each product page shows the current stock in real time.`,
      // FAQ vide par défaut : la section n'apparaît sur la page publique que
      // si l'admin a saisi au moins 1 question. Évite les FAQ génériques qui
      // se ressemblent d'une catégorie à l'autre (mauvais SEO).
      faq: [],
    };
  }

  return {
    title: `Grossiste ${lowerName} — ${shopName}`,
    intro: `Découvrez la sélection ${shopName} de ${lowerName} pour boutiques indépendantes et concept stores. Prix professionnels, minimum de commande accessible, livraison sous 48-72 h en France et en Europe.`,
    secondary: `Nos ${lowerName} sont sélectionné·es auprès de fabricants européens et asiatiques certifiés. Tailles et coloris renouvelés chaque saison — chaque fiche produit indique le stock disponible en temps réel.`,
    faq: [],
  };
}

/**
 * Résout le contenu SEO final (overrides admin > trame par défaut) pour une locale
 * donnée. Chaque champ est indépendant : la cliente peut n'écrire que le H1 et
 * laisser le reste en défaut.
 */
export function resolveCategorySeo(args: {
  categoryName: string;
  categoryNameLocalized: string;
  shopName: string;
  productCount: number;
  locale: "fr" | "en";
  overridesBase: {
    seoTitle: string | null;
    seoIntro: string | null;
    seoSecondary: string | null;
    seoFaq: unknown;
  };
  overridesTranslation?: {
    seoTitle: string | null;
    seoIntro: string | null;
    seoSecondary: string | null;
    seoFaq: unknown;
  } | null;
}): CategorySeoContent {
  const defaults = buildDefaultCategorySeo({
    categoryName: args.categoryNameLocalized,
    shopName: args.shopName,
    productCount: args.productCount,
    locale: args.locale,
  });

  const base = args.overridesBase;
  const trans = args.overridesTranslation ?? null;

  // Pour la locale non-FR : priorité à la traduction, sinon base FR (mieux qu'un
  // texte anglais générique par défaut si la cliente a rempli en FR seulement).
  const localizedOverride =
    args.locale === "fr"
      ? {
          seoTitle: base.seoTitle,
          seoIntro: base.seoIntro,
          seoSecondary: base.seoSecondary,
          seoFaq: base.seoFaq,
        }
      : {
          seoTitle: trans?.seoTitle ?? null,
          seoIntro: trans?.seoIntro ?? null,
          seoSecondary: trans?.seoSecondary ?? null,
          seoFaq: trans?.seoFaq ?? null,
        };

  const faq = parseFaq(localizedOverride.seoFaq);

  return {
    title: (localizedOverride.seoTitle ?? "").trim() || defaults.title,
    intro: (localizedOverride.seoIntro ?? "").trim() || defaults.intro,
    secondary: (localizedOverride.seoSecondary ?? "").trim() || defaults.secondary,
    faq: faq.length > 0 ? faq : defaults.faq,
  };
}

function parseFaq(raw: unknown): CategorySeoFaqItem[] {
  if (!Array.isArray(raw)) return [];
  const items: CategorySeoFaqItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const q = typeof (entry as { q?: unknown }).q === "string" ? (entry as { q: string }).q.trim() : "";
    const a = typeof (entry as { a?: unknown }).a === "string" ? (entry as { a: string }).a.trim() : "";
    if (q && a) items.push({ q, a });
  }
  return items;
}

/**
 * Génère le JSON-LD FAQPage à injecter dans le <head> ou en bas de page —
 * ouvre la porte aux rich snippets Google (encart déroulant dans les résultats).
 */
export function buildFaqJsonLd(items: CategorySeoFaqItem[]): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

/**
 * BreadcrumbList JSON-LD (Accueil > Catégories > Blouses).
 */
export function buildBreadcrumbJsonLd(args: {
  siteUrl: string;
  locale: string;
  categoryName: string;
  slug: string;
  labels: { home: string; categories: string };
}): Record<string, unknown> {
  const { siteUrl, locale, categoryName, slug, labels } = args;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: labels.home, item: `${siteUrl}/${locale}` },
      { "@type": "ListItem", position: 2, name: labels.categories, item: `${siteUrl}/${locale}/categories` },
      { "@type": "ListItem", position: 3, name: categoryName, item: `${siteUrl}/${locale}/categories/${slug}` },
    ],
  };
}

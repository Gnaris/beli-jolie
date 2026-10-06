import { prisma } from "@/lib/prisma";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

/**
 * Compteurs affichés dans la barre latérale admin (pastilles orange/bleues).
 *
 * Lecture LIVE — pas de cache. Les 11 count() tournent en parallèle (indexes
 * sur chaque colonne de filtre), ~50-100 ms au total. On privilégie la
 * fraîcheur : la cliente veut voir les pastilles bouger en temps réel quand
 * une commande tombe, un client s'inscrit, un SAV s'ouvre, une traduction
 * finit en fond.
 *
 * Scope tenant : la Prisma extension `tenant-scope` injecte automatiquement
 * `tenantId` dans tous les where via les headers de la requête courante.
 * Hors contexte requête (scripts CLI), l'extension passe en passthrough.
 */
export interface AdminWarningsCounts {
  /** Produits ONLINE/OFFLINE/ARCHIVED/SYNCING sans traduction complète (une locale non-FR manquante). */
  untranslatedCount: number;
  /** Couleurs sans aucune traduction. */
  unusedColorsCount: number;
  /** Compositions sans aucune traduction. */
  unusedCompositionsCount: number;
  /** Mots-clés sans aucune traduction. */
  unusedTagsCount: number;
  /** Catégories sans aucune traduction. */
  untranslatedCategoriesCount: number;
  /** Sous-catégories sans aucune traduction. */
  untranslatedSubCategoriesCount: number;
  /** Commandes en attente de traitement (status=PENDING). */
  pendingOrdersCount: number;
  /** Inscriptions clients en attente de validation (role=CLIENT + status=PENDING). */
  pendingUsersCount: number;
  /** SAV ouverts (status=OPEN). */
  openClaimsCount: number;
  /** Avis clients en attente de modération (status=PENDING). */
  pendingReviewsCount: number;
}

export async function fetchAdminWarnings(): Promise<AdminWarningsCounts> {
  const [
    totalProducts,
    fullyTranslatedProducts,
    unusedColorsCount,
    unusedCompositionsCount,
    unusedTagsCount,
    untranslatedCategoriesCount,
    untranslatedSubCategoriesCount,
    pendingOrdersCount,
    pendingUsersCount,
    openClaimsCount,
    pendingReviewsCount,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({
      where: {
        AND: NON_DEFAULT_LOCALES.map((locale) => ({ translations: { some: { locale } } })),
      },
    }),
    prisma.color.count({ where: { translations: { none: {} } } }),
    prisma.composition.count({ where: { translations: { none: {} } } }),
    prisma.tag.count({ where: { translations: { none: {} } } }),
    prisma.category.count({ where: { translations: { none: {} } } }),
    prisma.subCategory.count({ where: { translations: { none: {} } } }),
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { role: "CLIENT", status: "PENDING" } }),
    prisma.claim.count({ where: { status: "OPEN" } }),
    prisma.customerReview.count({ where: { status: "PENDING" } }),
  ]);

  const untranslatedCount = totalProducts - fullyTranslatedProducts;

  return {
    untranslatedCount,
    unusedColorsCount,
    unusedCompositionsCount,
    unusedTagsCount,
    untranslatedCategoriesCount,
    untranslatedSubCategoriesCount,
    pendingOrdersCount,
    pendingUsersCount,
    openClaimsCount,
    pendingReviewsCount,
  };
}

/**
 * Agrège les 6 catégories de « traductions manquantes » affichées sur l'entrée
 * de menu parent « Produits » : produit + couleur + composition + tag + cat + sous-cat.
 */
export function sumAttributeWarnings(counts: AdminWarningsCounts): number {
  return (
    counts.untranslatedCount +
    counts.unusedColorsCount +
    counts.unusedCompositionsCount +
    counts.unusedTagsCount +
    counts.untranslatedCategoriesCount +
    counts.untranslatedSubCategoriesCount
  );
}

export const ADMIN_WARNINGS_ZERO: AdminWarningsCounts = {
  untranslatedCount: 0,
  unusedColorsCount: 0,
  unusedCompositionsCount: 0,
  unusedTagsCount: 0,
  untranslatedCategoriesCount: 0,
  untranslatedSubCategoriesCount: 0,
  pendingOrdersCount: 0,
  pendingUsersCount: 0,
  openClaimsCount: 0,
  pendingReviewsCount: 0,
};

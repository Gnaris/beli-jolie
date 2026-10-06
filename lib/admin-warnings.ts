/**
 * Compteurs affichés dans la barre latérale admin (pastilles orange/bleues).
 *
 * Ce fichier est client-safe : il contient uniquement les types + helpers purs.
 * La lecture Prisma (`fetchAdminWarnings`) vit dans `admin-warnings-server.ts`.
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

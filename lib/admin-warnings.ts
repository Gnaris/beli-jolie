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

/**
 * Détail humain des traductions manquantes, utilisé par l'info-bulle du parent
 * « Produits » dans la sidebar admin. Chaque ligne ne figure que si le compteur
 * correspondant est > 0 — évite d'afficher « 0 produits sans traduction » dans
 * la liste. Les libellés accordent singulier/pluriel.
 *
 * Pourquoi ici (et pas inline dans AdminShellsLive) : extrait pour pouvoir
 * tester la logique sans rendre tout le shell admin.
 */
export function buildAttributeWarningReasons(counts: AdminWarningsCounts): string[] {
  const pluralize = (n: number, singular: string, plural: string) =>
    `${n} ${n > 1 ? plural : singular} sans traduction`;

  const catTotal = counts.untranslatedCategoriesCount + counts.untranslatedSubCategoriesCount;
  const rows: Array<{ count: number; label: string }> = [
    { count: counts.untranslatedCount,       label: pluralize(counts.untranslatedCount,       "produit",     "produits")     },
    { count: catTotal,                       label: pluralize(catTotal,                       "catégorie",   "catégories")   },
    { count: counts.unusedColorsCount,       label: pluralize(counts.unusedColorsCount,       "couleur",     "couleurs")     },
    { count: counts.unusedCompositionsCount, label: pluralize(counts.unusedCompositionsCount, "composition", "compositions") },
    { count: counts.unusedTagsCount,         label: pluralize(counts.unusedTagsCount,         "mot-clé",     "mots-clés")    },
  ];
  return rows.filter((r) => r.count > 0).map((r) => r.label);
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

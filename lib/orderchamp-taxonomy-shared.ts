/**
 * Types et helpers purs pour la taxonomie Orderchamp — safe côté client.
 * Aucune dépendance serveur (pas de prisma, pas de next/headers). Importable
 * depuis les composants client. La partie fetch/cache reste dans
 * `lib/orderchamp-taxonomy.ts`.
 */

export interface OrderchampCategoryNode {
  /** ID GraphQL Base64 côté OC. */
  id: string;
  /** Enum path (ex "JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS"). */
  path: string;
  /** Nom en anglais. */
  name: string;
  /** Profondeur dans l'arbre (0 = racine). */
  depth: number;
  /** Nom traduit en français si dispo, sinon fallback anglais. */
  nameFr: string;
}

/**
 * Retourne uniquement les feuilles de l'arbre (nodes qui n'ont pas d'enfant).
 * Utilisé par le sélecteur admin pour forcer une catégorie feuille (règle OC).
 */
export function filterLeavesOnly(all: OrderchampCategoryNode[]): OrderchampCategoryNode[] {
  const parentPaths = new Set<string>();
  for (const c of all) {
    // Le parent d'un node X_Y_Z est X_Y. On enregistre chaque préfixe possible.
    const segments = c.path.split("_");
    for (let i = 1; i < segments.length; i++) {
      parentPaths.add(segments.slice(0, i).join("_"));
    }
  }
  return all.filter((c) => !parentPaths.has(c.path));
}

/**
 * Récupère les enfants directs d'un node parent (pour un dropdown en cascade).
 * Passer `null` pour obtenir les racines.
 */
export function getChildrenOf(
  all: OrderchampCategoryNode[],
  parentPath: string | null,
): OrderchampCategoryNode[] {
  if (parentPath === null) {
    return all.filter((c) => c.depth === 0);
  }
  const targetDepth = parentPath.split("_").length; // parent depth + 1
  return all.filter(
    (c) => c.depth === targetDepth && c.path.startsWith(`${parentPath}_`),
  );
}

/**
 * Trouve un node par son enum path. Utilisé côté publish pour valider qu'un
 * `Category.orderchampCategoryId` mappé existe toujours dans la taxonomie.
 */
export function findByPath(
  all: OrderchampCategoryNode[],
  path: string,
): OrderchampCategoryNode | undefined {
  return all.find((c) => c.path === path);
}

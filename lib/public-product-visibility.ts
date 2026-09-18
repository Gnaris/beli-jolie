/**
 * Visibilité produit côté vitrine publique.
 *
 * Un produit est affichable sur les listings publics (page /produits,
 * catégories, collections, home, recherche, sitemap) si :
 *   - status === "ONLINE"
 *   - ET au moins une ProductColor `disabled: false` avec `stock > 0`
 *
 * Si toutes les variantes sont désactivées (`disabled: true`) OU si toutes
 * ont un stock à zéro, le produit disparaît des listings — sans être
 * archivé ni supprimé. Il revient dès qu'une variante active a du stock.
 *
 * La fiche produit `/produits/[slug]` reste accessible en direct (URL,
 * favori, backlink Google) : c'est un choix produit pour ne pas casser le
 * SEO acquis ni les liens externes.
 *
 * L'admin (`/admin/produits`) n'utilise PAS ce filtre : la cliente doit
 * voir tous ses produits pour les remettre en stock.
 */

/**
 * Clause « au moins une variante vendable » — à utiliser dans un `where`
 * Prisma sur `Product`. Toujours combiner avec `status: "ONLINE"`.
 */
export const PUBLIC_SELLABLE_COLORS_CLAUSE = {
  some: { disabled: false, stock: { gt: 0 } },
} as const;

/**
 * `where` complet pour un produit visible publiquement. À étendre avec les
 * autres filtres (catégorie, tag, recherche…) via spread.
 *
 * @example
 *   prisma.product.findMany({
 *     where: { ...publicVisibleProductWhere(), categoryId },
 *   });
 */
export function publicVisibleProductWhere(): {
  status: "ONLINE";
  colors: typeof PUBLIC_SELLABLE_COLORS_CLAUSE;
} {
  return {
    status: "ONLINE",
    colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
  };
}

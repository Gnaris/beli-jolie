/**
 * Choisit l'image principale à afficher dans la liste admin des produits.
 *
 * L'image étant rattachée au couple (Produit × Couleur), toutes les variantes
 * qui partagent la même couleur principale verront automatiquement la même
 * image — peu importe qu'elles soient UNIT ou PACK, ou qu'il y ait plusieurs
 * variantes pour la même couleur.
 *
 * Stratégie en 2 niveaux :
 *  1) Image de la couleur de la variante marquée principale.
 *     En cas de plusieurs principales (séquelle d'un ancien bug), on prend
 *     la plus récente — c'est le choix actif de l'utilisateur.
 *  2) Sinon : image de la 1ʳᵉ couleur (parmi les variantes triées) qui en a une.
 */
export function pickFirstImage(
  colors: { isPrimary: boolean; colorId: string | null }[],
  imagePathByColorId: (colorId: string | null) => string | null,
): string | null {
  let primary: { colorId: string | null } | null = null;
  for (let i = colors.length - 1; i >= 0; i--) {
    if (colors[i].isPrimary) { primary = colors[i]; break; }
  }
  if (primary) {
    const path = imagePathByColorId(primary.colorId);
    if (path) return path;
  }
  for (const c of colors) {
    const path = imagePathByColorId(c.colorId);
    if (path) return path;
  }
  return null;
}

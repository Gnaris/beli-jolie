/**
 * Compte les couleurs distinctes actives (non désactivées) sans aucune image.
 * Utilisé par la colonne « État » du tableau /admin/produits pour signaler
 * les fiches à compléter.
 *
 * Dédupliqué par colorId : un même produit peut avoir plusieurs ProductColor
 * pour la même couleur (ex. variante UNIT + variante PACK toutes deux en doré).
 * On ne veut compter la couleur qu'une seule fois. Une couleur est comptée
 * comme « sans image » seulement si TOUTES ses variantes sont soit désactivées
 * soit sans image — dès qu'une variante active a une image, la couleur est ok.
 *
 * Les produits archivés retournent toujours 0 (retirés du catalogue).
 */
export function countColorsMissingImage(input: {
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  productId: string;
  colors: Array<{ colorId: string | null; disabled: boolean }>;
  imagesByProductColor: Map<string, string>;
}): number {
  if (input.status === "ARCHIVED") return 0;
  const missing = new Set<string>();
  for (const c of input.colors) {
    if (c.disabled || !c.colorId) continue;
    if (!input.imagesByProductColor.has(`${input.productId}::${c.colorId}`)) {
      missing.add(c.colorId);
    }
  }
  return missing.size;
}

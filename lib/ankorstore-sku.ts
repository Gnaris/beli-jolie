/**
 * Génération des SKU envoyés à Ankorstore.
 *
 * Règle (mise à jour 2026-05-27) : **toujours auto-générer**, format simplifié.
 *
 *   {reference}_{couleur-slug}_{idSuffix}
 *
 * - `idSuffix` = 8 derniers caractères de l'UUID de la variante. Effectivement
 *   « aléatoire » pour un œil humain mais déterministe : la même variante
 *   produit toujours le même SKU.
 * - Plafond strict de `MAX_SKU_LENGTH` caractères pour éviter l'erreur
 *   « validation_error: Sku maximum » d'Ankorstore. En cas de dépassement,
 *   on rogne d'abord la couleur, puis la référence. Le suffixe d'ID reste
 *   **toujours intact** : c'est lui qui garantit l'unicité.
 *
 * On ignore systématiquement le champ `ProductColor.sku` stocké en BDD —
 * il a pu être rempli par une ancienne version du code (ancien format
 * avec taille/type/index) ou rester d'un import historique.
 *
 * Note importante : les variantes **déjà liées à AS** (`ankorsVariantId`
 * connu) sont protégées en amont par les appelants (publish/update) qui
 * utilisent le SKU réel d'AS pour ces variantes — donc changer la logique
 * locale ne risque pas de casser des liens existants.
 */

export const MAX_SKU_LENGTH = 48;

type Variant = {
  id: string;
  saleType: "UNIT" | "PACK";
  sku: string | null;
  color: { id: string; name: string } | null;
  variantSizes: { size: { name: string }; quantity: number }[];
  packLines: {
    sizes: { size: { name: string }; quantity: number }[];
  }[];
};

function slugifyPart(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function colorSlugForVariant(v: Variant, fallbackIndex: number): string {
  const name = v.color?.name;
  if (!name) return `v${fallbackIndex}`;
  return slugifyPart(name);
}

/**
 * Assemble le SKU final en garantissant que sa longueur ne dépasse pas
 * `MAX_SKU_LENGTH`. Le suffixe `_{idSuffix}` est sacré (garantit l'unicité).
 * On rogne en priorité la couleur, puis la référence — caractère par
 * caractère — jusqu'à passer sous la limite. Chaque morceau garde un
 * minimum lisible (3 / 2 caractères).
 */
function assembleSku(
  reference: string,
  colorSlug: string,
  idSuffix: string,
): string {
  let ref = reference;
  let color = colorSlug;

  const fixedTail = `_${idSuffix}`;

  const build = () => `${ref}_${color}${fixedTail}`;

  while (build().length > MAX_SKU_LENGTH) {
    if (color.length > 3) {
      color = color.slice(0, -1);
    } else if (ref.length > 2) {
      ref = ref.slice(0, -1);
    } else {
      break;
    }
  }

  return build();
}

function generatedSku(
  reference: string,
  v: Variant,
  index: number,
): string {
  const colorSlug = colorSlugForVariant(v, index);
  const idSuffix = v.id.slice(-8);
  return assembleSku(reference, colorSlug, idSuffix);
}

/**
 * Construit la map { variantId → sku } pour un produit donné.
 *
 * Régénère systématiquement le SKU pour TOUTES les variantes (on ignore le
 * SKU stocké en BDD). Voir doc du fichier pour le raisonnement.
 */
export function buildVariantSkus(
  reference: string,
  variants: Variant[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < variants.length; i++) {
    out.set(variants[i].id, generatedSku(reference, variants[i], i));
  }
  return out;
}

/**
 * Helper unitaire pour un seul SKU. À utiliser uniquement quand on n'a pas
 * accès à la liste complète des variantes. Préfère `buildVariantSkus` quand
 * possible (qui garantit l'unicité d'index pour le fallback de couleur).
 */
export function buildSingleVariantSku(
  reference: string,
  variant: Variant,
  index: number,
): string {
  return generatedSku(reference, variant, index);
}

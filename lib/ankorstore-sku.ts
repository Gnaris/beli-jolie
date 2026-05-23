/**
 * Génération des SKU envoyés à Ankorstore.
 *
 * Règle (mise à jour 2026-05-19) : **toujours auto-générer**.
 *
 * On ignore systématiquement le champ `ProductColor.sku` stocké en BDD —
 * il a pu être rempli par une ancienne version du code (sans taille ni
 * suffixe) ou rester d'un import historique. Pour garantir qu'aucun SKU
 * envoyé à AS ne puisse rentrer en conflit, on régénère TOUT à chaque
 * envoi avec le format complet :
 *
 *   {reference}_{couleur-slug}_{taille-slug}_{UNIT|PACK}_{index+1}_{idSuffix}
 *
 * **Limite de taille (2026-05-23)** : Ankorstore rejette les SKU au-delà
 * d'une certaine longueur avec « validation_error: Sku maximum ». On
 * applique un plafond strict de `MAX_SKU_LENGTH` caractères. Quand le SKU
 * complet dépasse, on raccourcit progressivement les morceaux dans cet
 * ordre : taille → couleur → référence. Le bloc final
 * `_{type}_{index}_{idSuffix}` reste **toujours intact** : c'est lui qui
 * garantit l'unicité (idSuffix = 8 derniers caractères de l'UUID variante).
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

function sizeSlugForVariant(v: Variant): string {
  if (v.saleType === "PACK") {
    if (v.packLines.length > 0 && v.packLines[0].sizes.length > 0) {
      return slugifyPart(v.packLines[0].sizes[0].size.name);
    }
  }
  if (v.variantSizes.length > 0) {
    return slugifyPart(v.variantSizes[0].size.name);
  }
  return "tu"; // Taille Unique
}

function colorSlugForVariant(v: Variant, fallbackIndex: number): string {
  const name = v.color?.name;
  if (!name) return `v${fallbackIndex}`;
  return slugifyPart(name);
}

/**
 * Assemble le SKU final en garantissant que sa longueur ne dépasse pas
 * `MAX_SKU_LENGTH`. Le suffixe `_{type}_{indexN}_{idSuffix}` est sacré
 * (garantit l'unicité). On rogne en priorité la taille, puis la couleur,
 * puis la référence — caractère par caractère — jusqu'à passer sous la
 * limite. Chaque morceau garde un minimum lisible (4 / 3 / 2 caractères).
 */
function assembleSku(
  reference: string,
  colorSlug: string,
  sizeSlug: string,
  saleType: "UNIT" | "PACK",
  indexLabel: string,
  idSuffix: string,
): string {
  let ref = reference;
  let color = colorSlug;
  let size = sizeSlug;

  const fixedTail = `_${saleType}_${indexLabel}_${idSuffix}`;

  const build = () => `${ref}_${color}_${size}${fixedTail}`;

  while (build().length > MAX_SKU_LENGTH) {
    if (size.length > 2) {
      size = size.slice(0, -1);
    } else if (color.length > 3) {
      color = color.slice(0, -1);
    } else if (ref.length > 4) {
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
  const sizeSlug = sizeSlugForVariant(v);
  const idSuffix = v.id.slice(-8);
  return assembleSku(
    reference,
    colorSlug,
    sizeSlug,
    v.saleType,
    String(index + 1),
    idSuffix,
  );
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
 * possible (qui garantit l'unicité d'index).
 */
export function buildSingleVariantSku(
  reference: string,
  variant: Variant,
  index: number,
): string {
  return generatedSku(reference, variant, index);
}

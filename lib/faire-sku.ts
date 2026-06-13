/**
 * Génération des SKU envoyés à Faire.
 *
 * Format simplifié, déterministe (la même variante = le même SKU) :
 *
 *   {reference}_{couleur-slug}_{UNIT|PACK}_{idSuffix}
 *
 * - `idSuffix` = 8 derniers caractères de l'UUID de la variante. Garantit
 *   l'unicité même quand 2 variantes BJ partagent référence + couleur.
 * - Le segment `UNIT`/`PACK` est gardé pour distinguer visuellement les deux
 *   modes de vente côté portail Faire (les SKU sont visibles aux retailers).
 * - Plafond strict de `MAX_SKU_LENGTH` caractères (60) — limite Faire confirmée
 *   par tap-faire (`sku` est généralement un VARCHAR(64)). On rogne d'abord
 *   la couleur, puis la référence. Le suffixe d'ID reste intact.
 *
 * On ignore systématiquement le champ `ProductColor.sku` stocké en BDD : il a
 * pu être généré par une logique antérieure (Ankorstore avec un autre format).
 */

export const MAX_FAIRE_SKU_LENGTH = 60;

type Variant = {
  id: string;
  saleType: "UNIT" | "PACK";
  color: { id: string; name: string } | null;
};

function slugifyPart(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

function colorSlugForVariant(v: Variant, fallbackIndex: number): string {
  const name = v.color?.name;
  if (!name) return `v${fallbackIndex}`;
  const slug = slugifyPart(name);
  return slug || `v${fallbackIndex}`;
}

function refSlug(reference: string): string {
  return reference.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function assembleSku(
  reference: string,
  colorSlug: string,
  saleType: "UNIT" | "PACK",
  idSuffix: string,
): string {
  let ref = refSlug(reference);
  let color = colorSlug;
  const fixedTail = `_${saleType}_${idSuffix}`;

  const build = () => `${ref}_${color}${fixedTail}`;

  while (build().length > MAX_FAIRE_SKU_LENGTH) {
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
  return assembleSku(reference, colorSlug, v.saleType, idSuffix);
}

/**
 * Construit la map { variantId → SKU Faire } pour un produit donné.
 * Régénère systématiquement le SKU pour TOUTES les variantes (on ignore le SKU stocké).
 */
export function buildFaireVariantSkus(
  reference: string,
  variants: Variant[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < variants.length; i++) {
    out.set(variants[i].id, generatedSku(reference, variants[i], i));
  }
  return out;
}

/** Helper unitaire — préférer `buildFaireVariantSkus` quand possible. */
export function buildSingleFaireSku(
  reference: string,
  variant: Variant,
  index: number,
): string {
  return generatedSku(reference, variant, index);
}

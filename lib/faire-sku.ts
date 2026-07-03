/**
 * Génération des SKU envoyés à Faire.
 *
 * Format simplifié, déterministe (la même variante = le même SKU) :
 *
 *   {reference}_{couleur-slug}[_{taille-slug}]_{UNIT|PACK}_{idSuffix}
 *
 * - `idSuffix` = 8 derniers caractères de l'UUID de la variante. Garantit
 *   l'unicité même quand 2 variantes BJ partagent référence + couleur.
 * - Le segment `taille-slug` n'est présent QUE quand la variante a une taille
 *   explicite ET que l'axe Size est activé côté payload (cas produits à
 *   plusieurs tailles distinctes, ex : bagues H30 en tailles 52/53/54/55).
 *   Ne pas inclure la taille pour les autres produits garantit la rétro-compat
 *   des SKU des 1051 produits déjà publiés sur Faire.
 * - Le segment `UNIT`/`PACK` est gardé pour distinguer visuellement les deux
 *   modes de vente côté portail Faire (les SKU sont visibles aux retailers).
 * - Plafond strict de `MAX_SKU_LENGTH` caractères (60) — limite Faire confirmée
 *   par tap-faire (`sku` est généralement un VARCHAR(64)). On rogne d'abord
 *   la taille, puis la couleur, puis la référence. Le suffixe d'ID reste intact.
 *
 * On ignore systématiquement le champ `ProductColor.sku` stocké en BDD : il a
 * pu être généré par une logique antérieure (Ankorstore avec un autre format).
 */

export const MAX_FAIRE_SKU_LENGTH = 60;

type Variant = {
  id: string;
  saleType: "UNIT" | "PACK";
  color: { id: string; name: string } | null;
  /** Optionnel : nom de la taille (ex "52"). Si absent, la taille n'apparaît
   *  pas dans le SKU. Utilisé UNIQUEMENT quand l'axe Size est activé côté
   *  payload Faire (produits avec ≥ 2 tailles distinctes). */
  sizeName?: string | null;
};

function slugifyPart(s: string): string {
  return s
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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

function sizeSlugForVariant(v: Variant): string | null {
  const name = v.sizeName;
  if (!name) return null;
  const slug = slugifyPart(name);
  return slug || null;
}

function refSlug(reference: string): string {
  return reference.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function assembleSku(
  reference: string,
  colorSlug: string,
  sizeSlug: string | null,
  saleType: "UNIT" | "PACK",
  idSuffix: string,
): string {
  let ref = refSlug(reference);
  let color = colorSlug;
  let size = sizeSlug;
  const fixedTail = `_${saleType}_${idSuffix}`;

  const build = () =>
    size ? `${ref}_${color}_${size}${fixedTail}` : `${ref}_${color}${fixedTail}`;

  while (build().length > MAX_FAIRE_SKU_LENGTH) {
    if (size && size.length > 1) {
      size = size.slice(0, -1);
    } else if (color.length > 3) {
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
  const sizeSlug = sizeSlugForVariant(v);
  const idSuffix = v.id.slice(-8);
  return assembleSku(reference, colorSlug, sizeSlug, v.saleType, idSuffix);
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

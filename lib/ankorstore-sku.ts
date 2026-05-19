/**
 * Génération des SKU envoyés à Ankorstore.
 *
 * Règles :
 *   - Si la variante a un SKU manuel renseigné côté BJ ET qu'il est unique
 *     parmi toutes les variantes du produit, on garde ce SKU manuel.
 *   - Sinon (pas de SKU manuel, OU SKU manuel partagé par ≥ 2 variantes du
 *     même produit ex: 3 tailles du même coloris), on génère un SKU auto.
 *
 * SKU auto :
 *   {reference}_{couleur-slug}_{taille-slug}_{UNIT|PACK}_{index+1}_{idSuffix}
 *
 * Pourquoi la taille dans le SKU : sans elle, deux variantes UNIT de la même
 * couleur en tailles différentes (ex : H39 Doré S vs H39 Doré M) ressortent
 * du formulaire BJ avec le même SKU manuel — et Ankorstore refuse les SKU
 * en doublon dans un même produit.
 *
 * Le suffix `idSuffix` (derniers 8 caractères de l'ID de variante BJ) reste
 * en queue pour garantir l'unicité même après archivage côté AS (un SKU une
 * fois utilisé chez eux est "cramé" et ne peut pas être réutilisé).
 */

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

function generatedSku(
  reference: string,
  v: Variant,
  index: number,
): string {
  const colorSlug = colorSlugForVariant(v, index);
  const sizeSlug = sizeSlugForVariant(v);
  const idSuffix = v.id.slice(-8);
  return `${reference}_${colorSlug}_${sizeSlug}_${v.saleType}_${index + 1}_${idSuffix}`;
}

/**
 * Construit la map { variantId → sku } pour un produit donné.
 * Détecte les SKU manuels en doublon et bascule les variantes concernées
 * sur SKU auto-généré.
 */
export function buildVariantSkus(
  reference: string,
  variants: Variant[],
): Map<string, string> {
  // Compte les SKU manuels (normalisés) pour détecter les doublons
  const manualSkuCount = new Map<string, number>();
  for (const v of variants) {
    const key = v.sku?.trim().toLowerCase();
    if (key) manualSkuCount.set(key, (manualSkuCount.get(key) ?? 0) + 1);
  }

  const out = new Map<string, string>();
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const manual = v.sku?.trim();
    const manualKey = manual?.toLowerCase();
    const isDuplicate = manualKey ? (manualSkuCount.get(manualKey) ?? 0) > 1 : false;

    if (manual && !isDuplicate) {
      out.set(v.id, manual);
      continue;
    }

    out.set(v.id, generatedSku(reference, v, i));
  }

  return out;
}

/**
 * Helper unitaire pour un seul SKU (sans contexte de doublon). À utiliser
 * uniquement quand on n'a pas accès à la liste complète des variantes.
 * Préfère `buildVariantSkus` quand possible.
 */
export function buildSingleVariantSku(
  reference: string,
  variant: Variant,
  index: number,
): string {
  const manual = variant.sku?.trim();
  if (manual) return manual;
  return generatedSku(reference, variant, index);
}

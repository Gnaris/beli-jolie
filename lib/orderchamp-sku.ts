/**
 * Génération des SKU envoyés à Orderchamp.
 *
 * Format identique à Faire pour cohérence catalogue :
 *
 *   {reference}_{couleur-slug}[_{taille-slug}]_{UNIT|PACK}_{idSuffix}
 *
 * - `idSuffix` = 8 derniers caractères de l'UUID de la variante.
 * - Le segment `taille-slug` est présent uniquement quand l'axe Size est activé
 *   côté payload (produits à plusieurs tailles distinctes).
 * - Plafond strict de `MAX_ORDERCHAMP_SKU_LENGTH` (60) — Orderchamp accepte
 *   jusqu'à 255 chars mais on garde 60 pour lisibilité et parité avec Faire.
 */

export const MAX_ORDERCHAMP_SKU_LENGTH = 60;

type Variant = {
  id: string;
  saleType: "UNIT" | "PACK";
  color: { id: string; name: string } | null;
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

  while (build().length > MAX_ORDERCHAMP_SKU_LENGTH) {
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

export function buildOrderchampVariantSkus(
  reference: string,
  variants: Variant[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < variants.length; i++) {
    out.set(variants[i].id, generatedSku(reference, variants[i], i));
  }
  return out;
}

export function buildSingleOrderchampSku(
  reference: string,
  variant: Variant,
  index: number,
): string {
  return generatedSku(reference, variant, index);
}

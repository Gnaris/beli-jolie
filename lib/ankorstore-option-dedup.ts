/**
 * Détection des variantes Ankorstore ayant des options `(color, size)`
 * identiques.
 *
 * Ankorstore rejette tout produit dont deux variantes portent la même paire
 * d'options `color`+`size` — même si les SKU sont distincts — avec l'erreur :
 *
 *   validation_error: Product variants with SKU: A,B have duplicated options
 *
 * On préfère détecter ce cas côté BJ **avant** le kickoff, pour :
 *  - éviter un aller-retour webhook qui échoue,
 *  - afficher à l'admin un message actionnable en français qui pointe la
 *    couleur en cause et l'invite à dédoubloner (renommer une couleur ou
 *    supprimer la variante en trop).
 *
 * La normalisation d'égalité aligne accents et casse pour éviter les faux
 * négatifs (« Doré » vs « doré », « Jaune » vs « jaune »).
 */

export interface AnkorstoreVariantForDedup {
  sku: string;
  options: { name: string; value: string }[];
}

export interface DuplicateOptionGroup {
  colorLabel: string;
  sizeLabel: string;
  skus: string[];
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function getOption(
  v: AnkorstoreVariantForDedup,
  name: "color" | "size",
): string {
  const opt = v.options.find((o) => o.name === name);
  return opt?.value ?? "";
}

/**
 * Retourne les groupes de variantes qui partagent la même paire (color, size).
 * Chaque groupe contient au moins 2 SKU (un doublon).
 *
 * Liste vide → aucun doublon détecté, publish OK côté Ankorstore.
 */
export function findDuplicateAnkorstoreOptions(
  variants: AnkorstoreVariantForDedup[],
): DuplicateOptionGroup[] {
  const groups = new Map<
    string,
    { colorLabel: string; sizeLabel: string; skus: string[] }
  >();

  for (const v of variants) {
    const color = getOption(v, "color");
    const size = getOption(v, "size");
    const key = `${normalize(color)}|${normalize(size)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.skus.push(v.sku);
    } else {
      groups.set(key, { colorLabel: color, sizeLabel: size, skus: [v.sku] });
    }
  }

  const duplicates: DuplicateOptionGroup[] = [];
  for (const g of groups.values()) {
    if (g.skus.length >= 2) duplicates.push(g);
  }
  return duplicates;
}

/**
 * Construit un message d'erreur français prêt à afficher à l'admin
 * quand un ou plusieurs doublons sont détectés.
 */
export function formatDuplicateOptionsError(
  duplicates: DuplicateOptionGroup[],
): string {
  if (duplicates.length === 0) return "";
  const lines = duplicates.map((d) => {
    const size = d.sizeLabel && d.sizeLabel !== "TU" ? ` / taille "${d.sizeLabel}"` : "";
    return `couleur "${d.colorLabel}"${size} (${d.skus.length} variantes)`;
  });
  return (
    `Ce produit a plusieurs variantes avec la même couleur et la même taille : ${lines.join(", ")}. ` +
    `Ankorstore refuse ce cas. Dédoublonnez côté fiche produit (renommez l'une des couleurs ou supprimez la variante en trop) puis relancez la publication.`
  );
}

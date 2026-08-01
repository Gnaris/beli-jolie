import { getAnkorstoreReferenceSuffixLength } from "@/lib/ankorstore-description";

const DESCRIPTION_MIN_CHARS = 30;
const COMPOSITION_TOTAL_TOLERANCE = 0.5;

export type MissingField =
  | "category"
  | "description"
  | "composition"
  | "country"
  | "season"
  | "prices"
  | "weights"
  | "stocks"
  | "sizes";

/**
 * Ordre d'affichage des badges "champ manquant" à côté du statut produit.
 * Range du plus général (catégorie/description) au plus fin (variantes) pour
 * que l'admin lise d'abord ce qui bloque la fiche entière puis ce qui bloque
 * une seule variante.
 */
export const MISSING_FIELD_ORDER: MissingField[] = [
  "category",
  "description",
  "composition",
  "country",
  "season",
  "prices",
  "weights",
  "stocks",
  "sizes",
];

export const MISSING_FIELD_LABELS: Record<MissingField, string> = {
  category:    "Catégorie manquante",
  description: "Description trop courte",
  composition: "Composition manquante",
  country:     "Pays manquant",
  season:      "Saison manquante",
  prices:      "Prix manquant",
  weights:     "Poids manquant",
  stocks:      "Stock manquant",
  sizes:       "Tailles manquantes",
};

export const MISSING_FIELD_TITLES: Record<MissingField, string> = {
  category:    "Aucune catégorie sélectionnée pour ce produit.",
  description: `La description fait moins de ${DESCRIPTION_MIN_CHARS} caractères (bloque Ankorstore).`,
  composition: "Aucune matière renseignée ou le total ne fait pas 100 %.",
  country:     "Aucun pays de fabrication renseigné.",
  season:      "Aucune saison renseignée.",
  prices:      "Au moins une variante active n'a pas de prix > 0.",
  weights:     "Au moins une variante active n'a pas de poids > 0.",
  stocks:      "Au moins une variante active n'a pas de stock défini.",
  sizes:       "Au moins une variante active n'a pas de taille.",
};

export interface MissingFieldsColorInput {
  disabled: boolean;
  unitPrice: number;
  weight: number | null;
  stock: number | null;
  variantSizes: Array<{ sizeId: string }>;
  packLines: Array<{ sizes: Array<{ sizeId: string }> }>;
}

export interface MissingFieldsInput {
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  reference: string;
  description: string;
  categoryId: string | null;
  countryIsoCode: string | null;
  seasonId: string | null;
  compositions: Array<{ percentage: number }>;
  colors: MissingFieldsColorInput[];
}

/**
 * Dérive la liste des champs manquants d'un produit pour affichage sous le
 * badge de statut dans /admin/produits. Fonction pure, alimentée par les
 * scalaires renvoyés par Prisma (aucune requête).
 *
 * ARCHIVED → toujours [] (le produit est retiré du catalogue, pas la peine
 * de rappeler ce qui manque). Alignement avec countColorsMissingImage.
 *
 * Les variantes désactivées (`disabled=true`) sont ignorées pour les champs
 * niveau variante (prices/weights/stocks/sizes) : elles ne partent ni côté
 * boutique ni côté marketplace, elles ne peuvent donc rien casser.
 */
export function computeMissingProductFields(input: MissingFieldsInput): MissingField[] {
  if (input.status === "ARCHIVED") return [];

  const missing = new Set<MissingField>();

  if (!input.categoryId) missing.add("category");

  const effectiveDescLen =
    input.description.trim().length +
    getAnkorstoreReferenceSuffixLength(input.reference);
  if (effectiveDescLen < DESCRIPTION_MIN_CHARS) missing.add("description");

  const totalPct = input.compositions.reduce((sum, c) => sum + c.percentage, 0);
  const compositionOk =
    input.compositions.length > 0 &&
    Math.abs(totalPct - 100) <= COMPOSITION_TOTAL_TOLERANCE;
  if (!compositionOk) missing.add("composition");

  if (!input.countryIsoCode) missing.add("country");
  if (!input.seasonId) missing.add("season");

  const activeColors = input.colors.filter((c) => !c.disabled);

  for (const c of activeColors) {
    if (!(c.unitPrice > 0)) missing.add("prices");
    if (c.weight === null || !(c.weight > 0)) missing.add("weights");
    if (c.stock === null || c.stock === undefined) missing.add("stocks");

    const isMultiColorPack = c.packLines.length > 0;
    const hasSizes = isMultiColorPack
      ? c.packLines.every((line) => line.sizes.length > 0)
      : c.variantSizes.length > 0;
    if (!hasSizes) missing.add("sizes");
  }

  return MISSING_FIELD_ORDER.filter((f) => missing.has(f));
}

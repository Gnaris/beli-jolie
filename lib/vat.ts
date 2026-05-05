/**
 * Calcul du taux de TVA appliqué à une commande BtoB.
 *
 * Règles (le mode de retrait n'écrase plus l'exonération admin) :
 * - France métropolitaine → 20 %
 * - DOM-TOM → 0 %
 * - UE hors France :
 *     - Si l'admin a validé l'exonération (`vatExempt = true`) → 0 %
 *       (auto-liquidation B2B intracom, peu importe livraison ou retrait)
 *     - Sinon → 20 %
 * - Hors UE → 0 %
 * - Pays inconnu / non renseigné → fallback 20 % si retrait, 0 % sinon.
 */

/** Taux de TVA française standard (20 %). */
export const FR_VAT_RATE = 0.2;

/** Codes ISO-2 des États membres de l'UE (incluant la France). */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL",
  "PT", "RO", "SE", "SI", "SK",
]);

/**
 * Codes ISO-2 des départements, régions et collectivités d'outre-mer français.
 * Considérés "hors champ TVA" comme des pays tiers : pas de TVA française.
 */
export const DOM_TOM_COUNTRIES: ReadonlySet<string> = new Set([
  "GP", // Guadeloupe
  "GF", // Guyane française
  "MQ", // Martinique
  "YT", // Mayotte
  "RE", // La Réunion
  "PM", // Saint-Pierre-et-Miquelon
  "BL", // Saint-Barthélemy
  "MF", // Saint-Martin (partie française)
  "WF", // Wallis-et-Futuna
  "PF", // Polynésie française
  "NC", // Nouvelle-Calédonie
  "TF", // Terres australes et antarctiques françaises
]);

/** Vrai si le pays est dans l'UE et n'est pas la France. */
export function isEuNonFrance(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  const code = countryCode.toUpperCase();
  return code !== "FR" && EU_COUNTRIES.has(code);
}

/** Vrai si le pays est un DOM-TOM français. */
export function isDomTom(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return DOM_TOM_COUNTRIES.has(countryCode.toUpperCase());
}

export interface VatRateInput {
  /** Code ISO-2 du pays de livraison (ou null si retrait). */
  countryCode: string | null | undefined;
  /** True si la commande est un retrait en boutique. */
  isPickup: boolean;
  /** True si l'admin a validé manuellement l'exonération TVA pour ce client. */
  vatExempt: boolean;
}

/**
 * Retourne le taux de TVA à appliquer (0 ou 0.20).
 */
export function resolveVatRate({ countryCode, isPickup, vatExempt }: VatRateInput): number {
  const code = countryCode?.toUpperCase() ?? "";
  if (code === "FR") return FR_VAT_RATE;
  if (DOM_TOM_COUNTRIES.has(code)) return 0;
  if (EU_COUNTRIES.has(code)) return vatExempt ? 0 : FR_VAT_RATE;
  // Pays inconnu / non renseigné : si on est en retrait boutique on retombe
  // sur la TVA française, sinon (export) 0 %.
  if (!code) return isPickup ? FR_VAT_RATE : 0;
  return 0;
}

/** Région d'un pays pour regroupement dans les listes déroulantes. */
export type CountryRegion = "EU" | "DOM_TOM" | "WORLD";

export interface Country {
  code: string;
  name: string;
  region: CountryRegion;
}

/**
 * Liste des pays disponibles dans le formulaire d'inscription.
 * Tri : pays UE (France en tête) → DOM-TOM → reste du monde (alphabétique).
 */
export const COUNTRIES: readonly Country[] = [
  // UE — France en tête
  { code: "FR", name: "France", region: "EU" },
  { code: "AT", name: "Autriche", region: "EU" },
  { code: "BE", name: "Belgique", region: "EU" },
  { code: "BG", name: "Bulgarie", region: "EU" },
  { code: "CY", name: "Chypre", region: "EU" },
  { code: "HR", name: "Croatie", region: "EU" },
  { code: "DK", name: "Danemark", region: "EU" },
  { code: "ES", name: "Espagne", region: "EU" },
  { code: "EE", name: "Estonie", region: "EU" },
  { code: "FI", name: "Finlande", region: "EU" },
  { code: "GR", name: "Grèce", region: "EU" },
  { code: "HU", name: "Hongrie", region: "EU" },
  { code: "IE", name: "Irlande", region: "EU" },
  { code: "IT", name: "Italie", region: "EU" },
  { code: "LV", name: "Lettonie", region: "EU" },
  { code: "LT", name: "Lituanie", region: "EU" },
  { code: "LU", name: "Luxembourg", region: "EU" },
  { code: "MT", name: "Malte", region: "EU" },
  { code: "NL", name: "Pays-Bas", region: "EU" },
  { code: "DE", name: "Allemagne", region: "EU" },
  { code: "PL", name: "Pologne", region: "EU" },
  { code: "PT", name: "Portugal", region: "EU" },
  { code: "CZ", name: "République tchèque", region: "EU" },
  { code: "RO", name: "Roumanie", region: "EU" },
  { code: "SK", name: "Slovaquie", region: "EU" },
  { code: "SI", name: "Slovénie", region: "EU" },
  { code: "SE", name: "Suède", region: "EU" },

  // DOM-TOM
  { code: "GP", name: "Guadeloupe", region: "DOM_TOM" },
  { code: "GF", name: "Guyane française", region: "DOM_TOM" },
  { code: "MQ", name: "Martinique", region: "DOM_TOM" },
  { code: "YT", name: "Mayotte", region: "DOM_TOM" },
  { code: "RE", name: "La Réunion", region: "DOM_TOM" },
  { code: "PM", name: "Saint-Pierre-et-Miquelon", region: "DOM_TOM" },
  { code: "BL", name: "Saint-Barthélemy", region: "DOM_TOM" },
  { code: "MF", name: "Saint-Martin", region: "DOM_TOM" },
  { code: "WF", name: "Wallis-et-Futuna", region: "DOM_TOM" },
  { code: "PF", name: "Polynésie française", region: "DOM_TOM" },
  { code: "NC", name: "Nouvelle-Calédonie", region: "DOM_TOM" },

  // Reste du monde (sélection commerce courante)
  { code: "AD", name: "Andorre", region: "WORLD" },
  { code: "AE", name: "Émirats arabes unis", region: "WORLD" },
  { code: "AR", name: "Argentine", region: "WORLD" },
  { code: "AU", name: "Australie", region: "WORLD" },
  { code: "BR", name: "Brésil", region: "WORLD" },
  { code: "CA", name: "Canada", region: "WORLD" },
  { code: "CH", name: "Suisse", region: "WORLD" },
  { code: "CI", name: "Côte d'Ivoire", region: "WORLD" },
  { code: "CL", name: "Chili", region: "WORLD" },
  { code: "CN", name: "Chine", region: "WORLD" },
  { code: "CO", name: "Colombie", region: "WORLD" },
  { code: "DZ", name: "Algérie", region: "WORLD" },
  { code: "EG", name: "Égypte", region: "WORLD" },
  { code: "GB", name: "Royaume-Uni", region: "WORLD" },
  { code: "HK", name: "Hong Kong", region: "WORLD" },
  { code: "ID", name: "Indonésie", region: "WORLD" },
  { code: "IL", name: "Israël", region: "WORLD" },
  { code: "IN", name: "Inde", region: "WORLD" },
  { code: "IS", name: "Islande", region: "WORLD" },
  { code: "JP", name: "Japon", region: "WORLD" },
  { code: "KR", name: "Corée du Sud", region: "WORLD" },
  { code: "LB", name: "Liban", region: "WORLD" },
  { code: "MA", name: "Maroc", region: "WORLD" },
  { code: "MC", name: "Monaco", region: "WORLD" },
  { code: "MX", name: "Mexique", region: "WORLD" },
  { code: "NO", name: "Norvège", region: "WORLD" },
  { code: "NZ", name: "Nouvelle-Zélande", region: "WORLD" },
  { code: "PE", name: "Pérou", region: "WORLD" },
  { code: "RU", name: "Russie", region: "WORLD" },
  { code: "SA", name: "Arabie saoudite", region: "WORLD" },
  { code: "SG", name: "Singapour", region: "WORLD" },
  { code: "SN", name: "Sénégal", region: "WORLD" },
  { code: "TH", name: "Thaïlande", region: "WORLD" },
  { code: "TN", name: "Tunisie", region: "WORLD" },
  { code: "TR", name: "Turquie", region: "WORLD" },
  { code: "TW", name: "Taïwan", region: "WORLD" },
  { code: "UA", name: "Ukraine", region: "WORLD" },
  { code: "US", name: "États-Unis", region: "WORLD" },
  { code: "VN", name: "Vietnam", region: "WORLD" },
  { code: "ZA", name: "Afrique du Sud", region: "WORLD" },
] as const;

/** Recherche un pays par code ISO-2. */
export function getCountry(code: string | null | undefined): Country | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return COUNTRIES.find((c) => c.code === upper) ?? null;
}

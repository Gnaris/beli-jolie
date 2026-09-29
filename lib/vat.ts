/**
 * Calcul du taux de TVA appliqué à une commande BtoB.
 *
 * Règles selon le mode de livraison :
 * - "pickup" (retrait boutique) → 20 % FR TOUJOURS
 *   La marchandise ne quitte pas la métropole, peu importe le pays de facturation.
 * - "merge" (fusion dans une commande parente) → hérite de `parentTvaRate` de la
 *   commande parente. Fallback 20 % si absent.
 * - "private" (transporteur privé du client) :
 *     - Livraison DOM-TOM → 0 % SEULEMENT si le client coche la case
 *       « Je certifie que le colis sera livré en {DOM-TOM}, exonéré de TVA FR ».
 *       Sinon 20 % FR par défaut (on ne peut pas prouver la sortie du territoire).
 *     - Autres pays → règle standard (delivery).
 * - "delivery" (défaut) :
 *     - France métropolitaine → 20 %
 *     - DOM-TOM → 0 %
 *     - UE hors France : vatExempt admin → 0 %, sinon → 20 %
 *     - Hors UE → 0 %
 *     - Pays inconnu / vide → 0 %
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

export type DeliveryModeForVat = "delivery" | "pickup" | "private" | "merge";

export interface VatRateInput {
  /** Code ISO-2 du pays de livraison (ou null si retrait). */
  countryCode: string | null | undefined;
  /** Mode de livraison choisi au checkout. */
  deliveryMode?: DeliveryModeForVat;
  /**
   * @deprecated Utiliser `deliveryMode = "pickup"`. Conservé pour compat.
   * Vaut `true` uniquement si `deliveryMode` n'est pas fourni.
   */
  isPickup?: boolean;
  /** True si l'admin a validé manuellement l'exonération TVA pour ce client. */
  vatExempt: boolean;
  /**
   * Mode "private" uniquement : true si le client a coché la case
   * « Je certifie que mon colis sera livré en {DOM-TOM}… ».
   * Sans cette case, on facture la TVA FR même sur adresse DOM-TOM.
   */
  domTomCertified?: boolean;
  /**
   * Mode "merge" uniquement : taux TVA de la commande parente. On s'aligne
   * dessus pour cohérence facture.
   */
  parentTvaRate?: number | null;
}

/**
 * Retourne le taux de TVA à appliquer (0 ou 0.20).
 */
export function resolveVatRate({
  countryCode,
  deliveryMode,
  isPickup,
  vatExempt,
  domTomCertified,
  parentTvaRate,
}: VatRateInput): number {
  const mode: DeliveryModeForVat = deliveryMode ?? (isPickup ? "pickup" : "delivery");
  const code = countryCode?.toUpperCase() ?? "";

  // 1. Retrait boutique → toujours 20 % FR (marchandise reste en métropole).
  if (mode === "pickup") return FR_VAT_RATE;

  // 2. Fusion → on hérite du taux de la commande parente pour cohérence.
  if (mode === "merge") {
    if (typeof parentTvaRate === "number") return parentTvaRate;
    return FR_VAT_RATE;
  }

  // 3. Transporteur privé sur adresse DOM-TOM : exonération uniquement si le
  //    client atteste par écrit (case cochée). Sinon TVA FR par défaut.
  if (mode === "private" && DOM_TOM_COUNTRIES.has(code)) {
    return domTomCertified ? 0 : FR_VAT_RATE;
  }

  // 4. Règle standard (delivery + private hors DOM-TOM).
  if (code === "FR") return FR_VAT_RATE;
  if (DOM_TOM_COUNTRIES.has(code)) return 0;
  if (EU_COUNTRIES.has(code)) return vatExempt ? 0 : FR_VAT_RATE;
  return 0;
}

/** Région d'un pays pour regroupement dans les listes déroulantes. */
export type CountryRegion = "EU" | "DOM_TOM" | "WORLD";

/**
 * Zone administrative pour le formulaire d'inscription B2B :
 * - "FR"     : France métropolitaine + DOM-TOM (règles SIRET/Kbis)
 * - "EU"     : Union européenne hors France (TVA intracom obligatoire)
 * - "WORLD"  : reste du monde (justificatif d'entreprise obligatoire)
 */
export type CompanyZone = "FR" | "EU" | "WORLD";

/**
 * Retourne la zone administrative d'un pays. France métropole + DOM-TOM
 * partagent la même zone "FR" car ils ont le même régime SIRET/Kbis, même
 * si la TVA les traite différemment.
 */
export function getCompanyZone(countryCode: string | null | undefined): CompanyZone {
  if (!countryCode) return "WORLD";
  const code = countryCode.toUpperCase();
  if (code === "FR" || DOM_TOM_COUNTRIES.has(code)) return "FR";
  if (EU_COUNTRIES.has(code)) return "EU";
  return "WORLD";
}

export interface Country {
  code: string;
  /** Libellé français affiché dans le sélecteur. */
  name: string;
  /** Région historique (utilisée pour la TVA — ne pas confondre avec CompanyZone). */
  region: CountryRegion;
}

/**
 * Liste des pays disponibles dans le formulaire d'inscription.
 * Ordre voulu par la cliente (2026-08-27) : France (Métropole) puis
 * chaque DOM-TOM libellé "France (…)" dans l'ordre alphabétique, ensuite
 * l'UE (hors France) alpha, puis le reste du monde alpha.
 * Les libellés "France (…)" permettent à l'utilisateur de choisir sa
 * collectivité sans confusion avec la métropole.
 */
export const COUNTRIES: readonly Country[] = [
  // France (Métropole + DOM-TOM) — France en tête, DOM-TOM alpha
  { code: "FR", name: "France (Métropole)", region: "EU" },
  { code: "GP", name: "France (Guadeloupe)", region: "DOM_TOM" },
  { code: "GF", name: "France (Guyane)", region: "DOM_TOM" },
  { code: "RE", name: "France (La Réunion)", region: "DOM_TOM" },
  { code: "MQ", name: "France (Martinique)", region: "DOM_TOM" },
  { code: "YT", name: "France (Mayotte)", region: "DOM_TOM" },
  { code: "NC", name: "France (Nouvelle-Calédonie)", region: "DOM_TOM" },
  { code: "PF", name: "France (Polynésie française)", region: "DOM_TOM" },
  { code: "BL", name: "France (Saint-Barthélemy)", region: "DOM_TOM" },
  { code: "MF", name: "France (Saint-Martin)", region: "DOM_TOM" },
  { code: "PM", name: "France (Saint-Pierre-et-Miquelon)", region: "DOM_TOM" },
  { code: "TF", name: "France (Terres australes)", region: "DOM_TOM" },
  { code: "WF", name: "France (Wallis-et-Futuna)", region: "DOM_TOM" },

  // UE hors France — alpha
  { code: "DE", name: "Allemagne", region: "EU" },
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
  { code: "PL", name: "Pologne", region: "EU" },
  { code: "PT", name: "Portugal", region: "EU" },
  { code: "CZ", name: "République tchèque", region: "EU" },
  { code: "RO", name: "Roumanie", region: "EU" },
  { code: "SK", name: "Slovaquie", region: "EU" },
  { code: "SI", name: "Slovénie", region: "EU" },
  { code: "SE", name: "Suède", region: "EU" },

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

/**
 * Libellé dynamique de la case à cocher DOM-TOM pour le mode transporteur privé.
 * Retourne null si le pays n'est pas un DOM-TOM (case non affichée).
 * Ex : « Je certifie que mon colis sera livré en France (Guadeloupe) et que
 *       la commande sera exonérée de la TVA française métropolitaine. »
 */
export function buildDomTomCertificationLabel(
  countryCode: string | null | undefined,
): string | null {
  if (!isDomTom(countryCode)) return null;
  const country = getCountry(countryCode);
  const name = country?.name ?? "DOM-TOM";
  return `Je certifie que mon colis sera livré en ${name} et que la commande sera exonérée de la TVA française métropolitaine.`;
}

/**
 * Conversion ISO 3166 alpha-2 → alpha-3 pour Faire.
 *
 * Faire exige le pays de fabrication en **alpha-3** (`CHN`, `PRT`, `FRA`…)
 * alors que notre BDD `ManufacturingCountry.isoCode` est en **alpha-2**
 * (`CN`, `PT`, `FR`…) — héritage PFS qui utilise l'alpha-2.
 *
 * On embarque uniquement les pays fournisseurs réellement utilisés par
 * Beli & Jolie (catalogue actuel + horizon raisonnable). Pour un pays inconnu
 * on retourne `null` → l'appelant doit décider du fallback (typiquement `CHN`).
 *
 * Liste à enrichir au fil des nouveaux fournisseurs — c'est un mapping figé,
 * pas un appel API.
 */

const ALPHA2_TO_ALPHA3: Record<string, string> = {
  // Asie
  CN: "CHN",
  HK: "HKG",
  TW: "TWN",
  JP: "JPN",
  KR: "KOR",
  IN: "IND",
  TH: "THA",
  VN: "VNM",
  ID: "IDN",
  MY: "MYS",
  PH: "PHL",
  BD: "BGD",
  PK: "PAK",
  // Europe
  FR: "FRA",
  IT: "ITA",
  ES: "ESP",
  PT: "PRT",
  DE: "DEU",
  BE: "BEL",
  NL: "NLD",
  GB: "GBR",
  IE: "IRL",
  AT: "AUT",
  CH: "CHE",
  PL: "POL",
  CZ: "CZE",
  RO: "ROU",
  GR: "GRC",
  TR: "TUR",
  SE: "SWE",
  DK: "DNK",
  FI: "FIN",
  NO: "NOR",
  // Amériques
  US: "USA",
  CA: "CAN",
  MX: "MEX",
  BR: "BRA",
  AR: "ARG",
  // Afrique du Nord / Moyen-Orient
  MA: "MAR",
  TN: "TUN",
  EG: "EGY",
  IL: "ISR",
  AE: "ARE",
  // Océanie
  AU: "AUS",
  NZ: "NZL",
};

/**
 * Convertit un code alpha-2 en alpha-3. Retourne null si inconnu — laisser
 * l'appelant choisir le fallback selon le contexte (ex: `CHN` pour les
 * bijoux fashion par défaut).
 */
export function alpha2ToAlpha3(alpha2: string | null | undefined): string | null {
  if (!alpha2) return null;
  const key = alpha2.trim().toUpperCase();
  if (key.length !== 2) {
    // Déjà en alpha-3 ? On accepte et on renvoie tel quel si format plausible.
    if (key.length === 3 && /^[A-Z]{3}$/.test(key)) return key;
    return null;
  }
  return ALPHA2_TO_ALPHA3[key] ?? null;
}

/**
 * Résout le pays de fabrication à envoyer à Faire :
 *   1. ISO alpha-2 BDD si reconnu → alpha-3
 *   2. Sinon fallback `CHN` (le catalogue BJ est massivement made-in-China)
 *
 * Le fallback est explicite et journalisé par l'appelant.
 */
export function resolveFaireCountry(
  alpha2: string | null | undefined,
  fallback = "CHN",
): string {
  return alpha2ToAlpha3(alpha2) ?? fallback;
}

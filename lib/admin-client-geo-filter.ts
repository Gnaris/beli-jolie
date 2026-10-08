/**
 * Filtres géographiques pour la liste des clients inscrits (/admin/clients).
 *
 * Deux filtres indépendants, combinés en AND :
 *   - `zone` : France métropole / France DOM-TOM / UE hors France / International
 *   - `countries` : liste explicite de codes ISO alpha-2
 *
 * Le code pays est stocké dans `User.addressCountry` (ISO-2).
 */

import type { Prisma } from "@prisma/client";

export type ClientGeoZone = "metropole" | "domtom" | "ue" | "intl";

export const CLIENT_GEO_ZONES: { value: ClientGeoZone; label: string }[] = [
  { value: "metropole", label: "France métropole" },
  { value: "domtom", label: "France DOM/TOM" },
  { value: "ue", label: "UE hors France" },
  { value: "intl", label: "International" },
];

// France métropole = FR seul.
const METROPOLE_CODE = "FR";

// Codes ISO des DOM-TOM reconnus (incluant les codes INSEE/ISO présents en base).
export const DOMTOM_CODES: readonly string[] = [
  "RE", // La Réunion
  "MQ", // Martinique
  "GP", // Guadeloupe
  "GF", // Guyane française
  "YT", // Mayotte
  "NC", // Nouvelle-Calédonie
  "PF", // Polynésie française
  "MF", // Saint-Martin (partie française)
  "WF", // Wallis-et-Futuna
  "PM", // Saint-Pierre-et-Miquelon
  "BL", // Saint-Barthélemy
  "TF", // Terres australes et antarctiques françaises
];

// Union européenne (France incluse).
const EU_CODES: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];

export const UE_HORS_FR_CODES: readonly string[] = EU_CODES.filter((c) => c !== METROPOLE_CODE);

const DOMTOM_SET = new Set(DOMTOM_CODES);
const EU_HORS_FR_SET = new Set(UE_HORS_FR_CODES);

/** Zone à laquelle appartient un code pays (null si inconnu / vide). */
export function resolveGeoZone(code: string | null | undefined): ClientGeoZone | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  if (upper === METROPOLE_CODE) return "metropole";
  if (DOMTOM_SET.has(upper)) return "domtom";
  if (EU_HORS_FR_SET.has(upper)) return "ue";
  return "intl";
}

/** Parse un query param `zone` → valeur typée (null si absent ou invalide). */
export function parseGeoZone(raw: string | string[] | undefined): ClientGeoZone | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return CLIENT_GEO_ZONES.some((z) => z.value === value) ? (value as ClientGeoZone) : null;
}

/** Parse un query param `countries=FR,BE,DE` → tableau de codes ISO uppercase dédoublonné. */
export function parseGeoCountries(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of value.split(",")) {
    const code = chunk.trim().toUpperCase();
    if (code.length === 2 && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/**
 * Construit le `WHERE` Prisma pour `addressCountry` à partir d'une zone
 * et/ou d'une liste de pays. Les 2 contraintes se combinent en AND.
 */
export function buildGeoFilterWhere(
  zone: ClientGeoZone | null,
  countries: readonly string[],
): Prisma.UserWhereInput {
  const conds: Prisma.UserWhereInput[] = [];

  if (zone === "metropole") {
    conds.push({ addressCountry: METROPOLE_CODE });
  } else if (zone === "domtom") {
    conds.push({ addressCountry: { in: [...DOMTOM_CODES] } });
  } else if (zone === "ue") {
    conds.push({ addressCountry: { in: [...UE_HORS_FR_CODES] } });
  } else if (zone === "intl") {
    const inScope = [METROPOLE_CODE, ...DOMTOM_CODES, ...UE_HORS_FR_CODES];
    conds.push({ addressCountry: { notIn: inScope, not: null } });
  }

  if (countries.length > 0) {
    conds.push({ addressCountry: { in: [...countries] } });
  }

  if (conds.length === 0) return {};
  if (conds.length === 1) return conds[0];
  return { AND: conds };
}

/**
 * lib/shipping-address-validate.ts
 *
 * Validation partagée d'une adresse de livraison — utilisée à la fois côté
 * client (bloquer le bouton « Enregistrer » et afficher un message) et côté
 * serveur (refuser toute création/mise à jour d'adresse incomplète, garde-fou
 * ultime contre les contournements navigateur).
 *
 * Contexte : Easy-Express et Smarty365 rejettent avec « please fill in the
 * 'City' field again » quand un champ obligatoire est vide. Sans validation,
 * la cliente admin se retrouve bloquée au moment de générer le bordereau
 * (cas Slovaquie 27BVT7AF — septembre 2026 : ville tapée dans l'adresse 1).
 */

/** Champs de l'adresse considérés comme obligatoires pour générer un bordereau. */
export type ShippingAddressField =
  | "firstName"
  | "lastName"
  | "address1"
  | "zipCode"
  | "city"
  | "country";

export const REQUIRED_ADDRESS_FIELDS: ShippingAddressField[] = [
  "firstName",
  "lastName",
  "address1",
  "zipCode",
  "city",
  "country",
];

export interface ShippingAddressInput {
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  zipCode?: string | null;
  city?: string | null;
  country?: string | null;
}

/**
 * Retourne la liste des champs obligatoires vides (après trim).
 * Tableau vide = adresse valide.
 */
export function findMissingAddressFields(
  input: ShippingAddressInput,
): ShippingAddressField[] {
  const missing: ShippingAddressField[] = [];
  for (const field of REQUIRED_ADDRESS_FIELDS) {
    const raw = input[field];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      missing.push(field);
    }
  }
  return missing;
}

/** Sentinelle d'erreur retournée par saveShippingAddress quand l'adresse est incomplète. */
export const ADDRESS_INCOMPLETE_PREFIX = "ADDRESS_INCOMPLETE:";

/**
 * Sérialise une liste de champs manquants pour la remonter au client via
 * un Error message parseable. Le client extrait ensuite les champs pour
 * afficher le message localisé.
 */
export function serializeMissingFields(missing: ShippingAddressField[]): string {
  return `${ADDRESS_INCOMPLETE_PREFIX}${missing.join(",")}`;
}

/**
 * Parse un message d'erreur serveur pour récupérer les champs manquants.
 * Retourne null si le message n'est pas une erreur d'adresse incomplète.
 */
export function parseMissingFieldsError(
  message: string | undefined | null,
): ShippingAddressField[] | null {
  if (!message || !message.startsWith(ADDRESS_INCOMPLETE_PREFIX)) return null;
  const raw = message.slice(ADDRESS_INCOMPLETE_PREFIX.length);
  if (!raw) return [];
  const valid = new Set<string>(REQUIRED_ADDRESS_FIELDS);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ShippingAddressField => valid.has(s));
}

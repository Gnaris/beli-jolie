/**
 * Helpers de format IBAN — 100 % pur (aucune dépendance Node/Prisma).
 * Importable côté client ET serveur.
 */

/**
 * Formatte un IBAN pour affichage : groupes de 4 caractères séparés par des
 * espaces, en majuscules. Ex "FR7630004028370001234567890" → "FR76 3000 4028 3700 0123 4567 890".
 */
export function formatIbanForDisplay(iban: string): string {
  const cleaned = iban.replace(/\s+/g, "").toUpperCase();
  return cleaned.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Normalise un IBAN saisi par l'admin : retire les espaces + majuscules.
 * Ne valide pas la checksum (over-engineering pour usage admin).
 */
export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/**
 * Validation basique du format IBAN (2 lettres pays + 2 chiffres clé + 11 à 30
 * alphanum). Sans vérification de checksum — suffisant pour éviter les typos
 * évidentes côté formulaire.
 */
export function isPlausibleIban(input: string): boolean {
  const iban = normalizeIban(input);
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban);
}

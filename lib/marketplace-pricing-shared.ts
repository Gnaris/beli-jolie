/**
 * Helpers purs partagés entre le serveur et le client (sans dépendance Prisma).
 * Utilisé par l'UI admin (calculette live) ET par les flows serveur de publish/update.
 */

export type MarkupType = "percent" | "fixed" | "multiplier";
export type RoundingMode = "none" | "down" | "up";

export interface MarkupConfig {
  type: MarkupType;
  value: number;
  rounding: RoundingMode;
}

/**
 * Applique un markup marketplace à un prix de base.
 * - percent : basePrice * (1 + value/100)
 * - fixed   : basePrice + value
 * - multiplier : basePrice * value
 * Puis arrondi : up/down au dixième d'euro (0,10 €), none garde 2 décimales.
 */
export function applyMarketplaceMarkup(
  basePrice: number,
  config: MarkupConfig
): number {
  if (config.value === 0) return basePrice;

  let price: number;
  switch (config.type) {
    case "percent":
      price = basePrice * (1 + config.value / 100);
      break;
    case "multiplier":
      price = basePrice * config.value;
      break;
    case "fixed":
    default:
      price = basePrice + config.value;
      break;
  }

  switch (config.rounding) {
    case "down":
      price = Math.floor(price * 10) / 10;
      break;
    case "up":
      price = Math.ceil(price * 10) / 10;
      break;
    case "none":
    default:
      price = Math.round(price * 100) / 100;
      break;
  }

  return price;
}

/**
 * Applique le markup wholesale + retail pour Faire et clamp le retail à
 * au moins 2x le wholesale (contrainte API Faire — rejet sinon).
 * Retourne les deux prix en euros (pas en centimes).
 */
export function applyFaireMarkupWithClamp(
  basePrice: number,
  wholesaleConfig: MarkupConfig,
  retailConfig: MarkupConfig
): { wholesale: number; retail: number } {
  const wholesale = applyMarketplaceMarkup(basePrice, wholesaleConfig);
  let retail = applyMarketplaceMarkup(basePrice, retailConfig);
  const minRetail = wholesale * 2;
  if (retail < minRetail) {
    retail = Math.ceil(minRetail * 10) / 10;
  }
  return { wholesale, retail };
}

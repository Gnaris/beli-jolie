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

  // Normalise en centimes AVANT l'arrondi pour éliminer le bruit IEEE-754.
  // Sans ça, `4.2 * 3 = 12.600000000000001` → `Math.ceil(126.0000…) = 127`
  // → 12,70 au lieu de 12,60 (bug reproduit sur U02 Faire, juillet 2026).
  const cents = Math.round(price * 100);
  switch (config.rounding) {
    case "down":
      price = (Math.floor(cents / 10) * 10) / 100;
      break;
    case "up":
      price = (Math.ceil(cents / 10) * 10) / 100;
      break;
    case "none":
    default:
      price = cents / 100;
      break;
  }

  return price;
}

/**
 * Applique le markup wholesale + retail pour Faire et clamp le retail à
 * au moins 2× le wholesale (contrainte API Faire — rejet sinon).
 * Retourne les deux prix en euros (pas en centimes).
 *
 * ⚠️ Le markup retail s'applique sur le WHOLESALE majoré, pas sur le
 * basePrice BJ. Convention métier confirmée par la cliente (juillet 2026,
 * bug U02) et alignée sur ce que fait déjà Ankorstore
 * (`lib/ankorstore-pricing.ts:71-77`). Exemple U02 :
 *   - base BJ 4,20 € · wholesale +20 % arrondi haut = 5,10 €
 *   - retail ×3 sur 5,10 € = 15,30 € (et non 4,20 × 3 = 12,60 €).
 */
export function applyFaireMarkupWithClamp(
  basePrice: number,
  wholesaleConfig: MarkupConfig,
  retailConfig: MarkupConfig
): { wholesale: number; retail: number } {
  const wholesale = applyMarketplaceMarkup(basePrice, wholesaleConfig);
  let retail = applyMarketplaceMarkup(wholesale, retailConfig);
  const minRetail = wholesale * 2;
  if (retail < minRetail) {
    // Arrondi haut au dixième via passage par les centimes (même parade
    // IEEE-754 que dans applyMarketplaceMarkup).
    const minRetailCents = Math.round(minRetail * 100);
    retail = (Math.ceil(minRetailCents / 10) * 10) / 100;
  }
  return { wholesale, retail };
}

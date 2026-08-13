// Logique pure de rotation automatique de la couleur principale d'un produit.
//
// Règle métier (validée par la cliente 2026-08-13) :
// - Si la couleur principale actuelle est entièrement en rupture (toutes ses
//   variantes ont stock === 0 OU disabled === true), on bascule la couleur
//   principale vers la 1ʳᵉ couleur qui a encore une variante disponible.
// - Si TOUTES les couleurs du produit sont en rupture, on ne change rien
//   (le produit est totalement en rupture — laisser la couleur choisie par la
//   cliente pour qu'elle réapparaisse en tête quand le stock revient).
// - Si la couleur principale est encore disponible, on ne change rien.
//
// L'orchestration BDD + push marketplace est faite dans rotate-primary-service.ts.
// Ce fichier est 100 % pur pour être testable sans mocks.

export interface RotationVariantInput {
  /** ID de la couleur (Color.id) portée par cette variante — null si legacy sans couleur. */
  colorId: string | null;
  /** Stock actuel de cette variante. */
  stock: number;
  /** Variante masquée côté client (bouton « Désactiver »). Compte comme rupture. */
  disabled: boolean;
}

export interface RotationInput {
  /** Variantes du produit, dans l'ordre qui servira à choisir la nouvelle
   *  couleur principale (première couleur disponible gagne). Généralement
   *  l'ordre du tableau `Product.colors` retourné par Prisma (isPrimary desc
   *  puis createdAt asc). */
  colors: RotationVariantInput[];
  /** Couleur principale actuelle du produit (Product.primaryColorId). Null =
   *  pas de couleur principale définie, on n'agit pas. */
  currentPrimaryColorId: string | null;
}

export interface RotationDecision {
  /** Nouveau `Product.primaryColorId` à écrire en BDD. */
  nextPrimaryColorId: string;
}

/** Une couleur est disponible si au moins une de ses variantes est active
 *  (non désactivée) ET a du stock. */
function isColorAvailable(variants: RotationVariantInput[]): boolean {
  return variants.some((v) => !v.disabled && v.stock > 0);
}

/**
 * Retourne la décision de rotation, ou `null` si rien ne doit changer.
 *
 * Cas couverts :
 * - couleur principale absente / non définie → null
 * - couleur principale toujours disponible → null
 * - couleur principale en rupture + une autre couleur dispo → rotation vers cette autre
 * - couleur principale en rupture + toutes les autres aussi → null (rupture totale)
 */
export function decidePrimaryRotation(input: RotationInput): RotationDecision | null {
  if (!input.currentPrimaryColorId) return null;

  // Regroupe les variantes par colorId — une couleur peut avoir plusieurs
  // variantes (ex. UNIT + PACK, ou plusieurs déclinaisons de tailles).
  const byColor = new Map<string, RotationVariantInput[]>();
  for (const variant of input.colors) {
    if (!variant.colorId) continue;
    const list = byColor.get(variant.colorId);
    if (list) list.push(variant);
    else byColor.set(variant.colorId, [variant]);
  }

  const currentVariants = byColor.get(input.currentPrimaryColorId);
  const currentAvailable = currentVariants ? isColorAvailable(currentVariants) : false;
  if (currentAvailable) return null;

  // Cherche la 1ʳᵉ couleur disponible ≠ courante en respectant l'ordre d'entrée
  // (déterministe pour la cliente : elle voit toujours basculer vers la même).
  const seen = new Set<string>();
  for (const variant of input.colors) {
    const colorId = variant.colorId;
    if (!colorId) continue;
    if (colorId === input.currentPrimaryColorId) continue;
    if (seen.has(colorId)) continue;
    seen.add(colorId);
    const variants = byColor.get(colorId);
    if (variants && isColorAvailable(variants)) {
      return { nextPrimaryColorId: colorId };
    }
  }

  return null;
}

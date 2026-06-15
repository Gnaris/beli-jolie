/**
 * Faire Sync Diff — compare un snapshot de l'état envoyé à Faire avec l'état
 * courant pour ne PATCH que ce qui a changé.
 *
 * Stockage : `Product.faireLastSyncSnapshot` (Json?). Mis à jour à la fin de
 * chaque sync réussie. `null` = premier publish ou refresh qui a remplacé
 * `faireProductId` → tout est considéré comme à envoyer (reset complet).
 *
 * Calqué sur `lib/pfs-sync-diff.ts`. Différences notables :
 *   - pas d'option « best seller » côté Faire (équivalent inexistant)
 *   - le `lifecycle_state` Faire combine 2 axes (lifecycle + sale) — on les
 *     traque tous les 2 dans le snapshot.
 *   - les images Faire sont au niveau VARIANTE (pas produit / couleur séparé)
 *     pour notre cas — on suit donc `images` par SKU.
 */

// v2 : bascule sur les vrais noms de champs Faire (made_in_country alpha-2 +
// tariff_code sur variante + sale_state SALES_PAUSED) après confirmation IA
// Faire (juin 2026). v1 snapshots sont automatiquement considérés "à réenvoyer".
// v3 : capture les dimensions (length/width/height en mm) côté variante — sans
// ça, modifier les dimensions ne déclenchait aucun envoi à Faire.
// v4 : on envoie les dimensions à Faire en CENTIMÈTRES (`distance_unit:
// CENTIMETERS`). La BDD reste en mm, conversion ÷10 au moment du payload.
// Les snapshots v3 (en mm) sont automatiquement considérés à réenvoyer.
// v5 : capture les images au niveau produit racine (image principale Faire),
// pour qu'un changement de la couleur primaire ou des images de la couleur
// primaire déclenche bien un PATCH /products/{id}.
export const FAIRE_SNAPSHOT_VERSION = 5 as const;

export interface FaireProductFieldsSnapshot {
  name: string;
  shortDescription: string;
  description: string;
  taxonomyTypeId: string;
  /** Pays alpha-2 envoyé en `made_in_country` (ex : "CN"). */
  countryAlpha2: string;
  minimumOrderQuantity: number;
  perStyleMinimumOrderQuantity: number;
  /** Images au niveau produit racine (image principale Faire), dans l'ordre. */
  images: string[];
}

export interface FaireVariantSnapshot {
  sku: string;
  wholesalePriceCents: number;
  retailPriceCents: number;
  availableQuantity: number;
  active: boolean;
  /** Couleur affichée côté Faire (option "Color"). */
  colorOption: string;
  /** Images de cette variante, dans l'ordre. */
  images: string[];
  /** Mesures envoyées (gardées pour diff). */
  weightGrams: number | null;
  /**
   * Dimensions envoyées à Faire en CENTIMÈTRES (BJ stocke au niveau produit en mm,
   * conversion ÷10 au moment du payload). On duplique sur chaque variante côté Faire.
   */
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  /** Code SH envoyé sur la variante (`tariff_code`) — null si non rempli. */
  tariffCode: string | null;
}

export interface FaireSyncSnapshot {
  schemaVersion: typeof FAIRE_SNAPSHOT_VERSION;
  product: FaireProductFieldsSnapshot;
  /** Variantes indexées par SKU (l'ID Faire `po_xxx` peut ne pas être connu au moment du diff). */
  variants: { [sku: string]: FaireVariantSnapshot };
  lifecycleState: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  // sale_state retiré : Faire le gère seul (read-only via API).
}

export interface FaireSyncDiff {
  productChanged: boolean;
  variantsChanged: string[];
  variantsAdded: string[];
  variantsRemoved: string[];
  /** Variantes dont seul le stock a changé — peuvent passer par l'endpoint inventory bulk. */
  inventoryOnlyChanged: string[];
  /** Variantes dont seul le prix a changé — utiliser product-prices/by-skus. */
  pricesOnlyChanged: string[];
  lifecycleChanged: boolean;
}

function stringListEqual(a: readonly string[] | undefined | null, b: readonly string[] | undefined | null): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

export function productFieldsEqual(
  a: FaireProductFieldsSnapshot,
  b: FaireProductFieldsSnapshot,
): boolean {
  return (
    a.name === b.name &&
    a.shortDescription === b.shortDescription &&
    a.description === b.description &&
    a.taxonomyTypeId === b.taxonomyTypeId &&
    a.countryAlpha2 === b.countryAlpha2 &&
    a.minimumOrderQuantity === b.minimumOrderQuantity &&
    a.perStyleMinimumOrderQuantity === b.perStyleMinimumOrderQuantity &&
    stringListEqual(a.images, b.images)
  );
}

export interface VariantDiffDetail {
  inventoryChanged: boolean;
  pricesChanged: boolean;
  otherChanged: boolean;
}

export function diffVariantSnapshot(
  prev: FaireVariantSnapshot,
  next: FaireVariantSnapshot,
): VariantDiffDetail {
  const inventoryChanged = prev.availableQuantity !== next.availableQuantity;
  const pricesChanged =
    prev.wholesalePriceCents !== next.wholesalePriceCents ||
    prev.retailPriceCents !== next.retailPriceCents;
  const otherChanged =
    prev.colorOption !== next.colorOption ||
    prev.active !== next.active ||
    prev.weightGrams !== next.weightGrams ||
    prev.lengthCm !== next.lengthCm ||
    prev.widthCm !== next.widthCm ||
    prev.heightCm !== next.heightCm ||
    prev.tariffCode !== next.tariffCode ||
    !stringListEqual(prev.images, next.images);
  return { inventoryChanged, pricesChanged, otherChanged };
}

export function diffSnapshots(
  prev: FaireSyncSnapshot | null,
  next: FaireSyncSnapshot,
): FaireSyncDiff {
  if (!prev || prev.schemaVersion !== FAIRE_SNAPSHOT_VERSION) {
    return {
      productChanged: true,
      variantsChanged: Object.keys(next.variants),
      variantsAdded: Object.keys(next.variants),
      variantsRemoved: [],
      inventoryOnlyChanged: [],
      pricesOnlyChanged: [],
      lifecycleChanged: true,
    };
  }

  const productChanged = !productFieldsEqual(prev.product, next.product);
  const lifecycleChanged = prev.lifecycleState !== next.lifecycleState;

  const variantsChanged: string[] = [];
  const variantsAdded: string[] = [];
  const variantsRemoved: string[] = [];
  const inventoryOnlyChanged: string[] = [];
  const pricesOnlyChanged: string[] = [];

  for (const [sku, nextVariant] of Object.entries(next.variants)) {
    const prevVariant = prev.variants[sku];
    if (!prevVariant) {
      variantsAdded.push(sku);
      variantsChanged.push(sku);
      continue;
    }
    const detail = diffVariantSnapshot(prevVariant, nextVariant);
    if (detail.otherChanged) {
      variantsChanged.push(sku);
    } else if (detail.inventoryChanged && !detail.pricesChanged) {
      inventoryOnlyChanged.push(sku);
    } else if (detail.pricesChanged && !detail.inventoryChanged) {
      pricesOnlyChanged.push(sku);
    } else if (detail.pricesChanged && detail.inventoryChanged) {
      variantsChanged.push(sku);
    }
  }

  for (const sku of Object.keys(prev.variants)) {
    if (!(sku in next.variants)) variantsRemoved.push(sku);
  }

  return {
    productChanged,
    variantsChanged,
    variantsAdded,
    variantsRemoved,
    inventoryOnlyChanged,
    pricesOnlyChanged,
    lifecycleChanged,
  };
}

export function diffIsEmpty(diff: FaireSyncDiff): boolean {
  return (
    !diff.productChanged &&
    !diff.lifecycleChanged &&
    diff.variantsChanged.length === 0 &&
    diff.variantsAdded.length === 0 &&
    diff.variantsRemoved.length === 0 &&
    diff.inventoryOnlyChanged.length === 0 &&
    diff.pricesOnlyChanged.length === 0
  );
}

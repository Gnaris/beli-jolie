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

export const FAIRE_SNAPSHOT_VERSION = 1 as const;

export interface FaireProductFieldsSnapshot {
  name: string;
  shortDescription: string;
  description: string;
  taxonomyTypeId: string;
  countryAlpha3: string;
  materials: string[];
  hsCode: string;
  minimumOrderQuantity: number;
  perStyleMinimumOrderQuantity: number;
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
}

export interface FaireSyncSnapshot {
  schemaVersion: typeof FAIRE_SNAPSHOT_VERSION;
  product: FaireProductFieldsSnapshot;
  /** Variantes indexées par SKU (l'ID Faire `po_xxx` peut ne pas être connu au moment du diff). */
  variants: { [sku: string]: FaireVariantSnapshot };
  lifecycleState: "DRAFT" | "PUBLISHED" | "RETIRED";
  saleState: "FOR_SALE" | "NOT_FOR_SALE";
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
  saleStateChanged: boolean;
}

function stringListEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
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
    a.countryAlpha3 === b.countryAlpha3 &&
    a.hsCode === b.hsCode &&
    a.minimumOrderQuantity === b.minimumOrderQuantity &&
    a.perStyleMinimumOrderQuantity === b.perStyleMinimumOrderQuantity &&
    stringListEqual([...a.materials].sort(), [...b.materials].sort())
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
      saleStateChanged: true,
    };
  }

  const productChanged = !productFieldsEqual(prev.product, next.product);
  const lifecycleChanged = prev.lifecycleState !== next.lifecycleState;
  const saleStateChanged = prev.saleState !== next.saleState;

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
    saleStateChanged,
  };
}

export function diffIsEmpty(diff: FaireSyncDiff): boolean {
  return (
    !diff.productChanged &&
    !diff.lifecycleChanged &&
    !diff.saleStateChanged &&
    diff.variantsChanged.length === 0 &&
    diff.variantsAdded.length === 0 &&
    diff.variantsRemoved.length === 0 &&
    diff.inventoryOnlyChanged.length === 0 &&
    diff.pricesOnlyChanged.length === 0
  );
}

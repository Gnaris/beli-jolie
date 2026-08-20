/**
 * Orderchamp Sync Diff — compare un snapshot de l'état envoyé à Orderchamp
 * avec l'état courant pour ne PATCH que ce qui a changé.
 *
 * Stockage : `Product.orderchampLastSyncSnapshot` (Json?). `null` = premier
 * publish ou refresh → tout considéré comme à envoyer.
 *
 * Miroir de `lib/faire-sync-diff.ts` — adapter selon les particularités
 * GraphQL Orderchamp au fil de l'intégration.
 */

export const ORDERCHAMP_SNAPSHOT_VERSION = 1 as const;

export interface OrderchampProductFieldsSnapshot {
  title: string;
  description: string;
  categoryId: string;
  vendor: string;
  countryAlpha2: string;
  productType: string;
  tags: string[];
  /** Images au niveau produit racine. */
  images: string[];
}

export interface OrderchampVariantSnapshot {
  sku: string;
  wholesalePriceCents: number;
  retailPriceCents: number;
  availableQuantity: number;
  active: boolean;
  colorOption: string;
  sizeOption: string | null;
  images: string[];
  weightGrams: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  /** ID GraphQL Orderchamp de la variante — indispensable pour DELETE. */
  orderchampVariantId?: string | null;
}

export interface OrderchampSyncSnapshot {
  schemaVersion: typeof ORDERCHAMP_SNAPSHOT_VERSION;
  product: OrderchampProductFieldsSnapshot;
  variants: { [sku: string]: OrderchampVariantSnapshot };
  lifecycleState: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
}

export interface OrderchampSyncDiff {
  productChanged: boolean;
  productImagesChanged: boolean;
  variantsChanged: string[];
  variantsImagesChanged: string[];
  variantsAdded: string[];
  variantsRemoved: string[];
  inventoryOnlyChanged: string[];
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

export function productMetaEqual(
  a: OrderchampProductFieldsSnapshot,
  b: OrderchampProductFieldsSnapshot,
): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.categoryId === b.categoryId &&
    a.vendor === b.vendor &&
    a.countryAlpha2 === b.countryAlpha2 &&
    a.productType === b.productType &&
    stringListEqual(a.tags, b.tags)
  );
}

export function productFieldsEqual(
  a: OrderchampProductFieldsSnapshot,
  b: OrderchampProductFieldsSnapshot,
): boolean {
  return productMetaEqual(a, b) && stringListEqual(a.images, b.images);
}

export interface VariantDiffDetail {
  inventoryChanged: boolean;
  pricesChanged: boolean;
  otherChanged: boolean;
  imagesChanged: boolean;
}

export function diffVariantSnapshot(
  prev: OrderchampVariantSnapshot,
  next: OrderchampVariantSnapshot,
): VariantDiffDetail {
  const inventoryChanged = prev.availableQuantity !== next.availableQuantity;
  const pricesChanged =
    prev.wholesalePriceCents !== next.wholesalePriceCents ||
    prev.retailPriceCents !== next.retailPriceCents;
  const imagesChanged = !stringListEqual(prev.images, next.images);
  const otherChanged =
    prev.colorOption !== next.colorOption ||
    prev.sizeOption !== next.sizeOption ||
    prev.active !== next.active ||
    prev.weightGrams !== next.weightGrams ||
    prev.lengthCm !== next.lengthCm ||
    prev.widthCm !== next.widthCm ||
    prev.heightCm !== next.heightCm;
  return { inventoryChanged, pricesChanged, otherChanged, imagesChanged };
}

export function diffSnapshots(
  prev: OrderchampSyncSnapshot | null,
  next: OrderchampSyncSnapshot,
  options?: { forceImages?: boolean },
): OrderchampSyncDiff {
  if (!prev || prev.schemaVersion !== ORDERCHAMP_SNAPSHOT_VERSION) {
    const forceImages = options?.forceImages === true;
    return {
      productChanged: true,
      productImagesChanged: forceImages,
      variantsChanged: Object.keys(next.variants),
      variantsImagesChanged: forceImages ? Object.keys(next.variants) : [],
      variantsAdded: Object.keys(next.variants),
      variantsRemoved: [],
      inventoryOnlyChanged: [],
      pricesOnlyChanged: [],
      lifecycleChanged: true,
    };
  }

  const productMetaChanged = !productMetaEqual(prev.product, next.product);
  const productImagesChanged = !stringListEqual(prev.product.images, next.product.images);
  const productChanged = productMetaChanged || productImagesChanged;
  const lifecycleChanged = prev.lifecycleState !== next.lifecycleState;

  const variantsChanged: string[] = [];
  const variantsImagesChanged: string[] = [];
  const variantsAdded: string[] = [];
  const variantsRemoved: string[] = [];
  const inventoryOnlyChanged: string[] = [];
  const pricesOnlyChanged: string[] = [];

  for (const [sku, nextVariant] of Object.entries(next.variants)) {
    const prevVariant = prev.variants[sku];
    if (!prevVariant) {
      variantsAdded.push(sku);
      variantsChanged.push(sku);
      variantsImagesChanged.push(sku);
      continue;
    }
    const detail = diffVariantSnapshot(prevVariant, nextVariant);
    if (detail.imagesChanged) variantsImagesChanged.push(sku);
    if (detail.otherChanged || detail.imagesChanged) {
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
    productImagesChanged,
    variantsChanged,
    variantsImagesChanged,
    variantsAdded,
    variantsRemoved,
    inventoryOnlyChanged,
    pricesOnlyChanged,
    lifecycleChanged,
  };
}

export function diffIsEmpty(diff: OrderchampSyncDiff): boolean {
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

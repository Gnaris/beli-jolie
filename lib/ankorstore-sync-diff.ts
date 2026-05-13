/**
 * Ankorstore Sync Diff — Compare un instantané du dernier état envoyé à Ankorstore
 * avec l'état courant pour ne renvoyer que les changements lors d'un update.
 *
 * Le snapshot vit dans `Product.ankorstoreLastSyncSnapshot` (JSON). Il est mis à
 * jour à la fin de chaque sync réussie. Quand il est null (premier publish, ou
 * refresh qui remplace l'ankorstoreProductId), on traite tout comme "à envoyer".
 */

export const ANKORSTORE_SNAPSHOT_VERSION = 3 as const;

export interface AnkorstoreProductFieldsSnapshot {
  externalId: string; // Product.reference
  name: string;
  description: string; // formatted (composition + ref appended)
  vatRate: number;
  countryCode: string; // ISO 2-letters
  unitMultiplier: number;
  brandName: string;
  /**
   * Poids en grammes (entier) pour éviter les imprécisions float lors du diff.
   * `null` quand aucun poids n'est renseigné côté local.
   */
  weightGrams: number | null;
  /**
   * Dimensions en millimètres (entiers) pour le même motif. `null` quand
   * l'axe n'est pas renseigné côté local.
   */
  dimensionLengthMm: number | null;
  dimensionWidthMm: number | null;
  dimensionHeightMm: number | null;
  /**
   * Code SH (douanier) trimmé. `null` quand non renseigné côté local.
   */
  hsCode: string | null;
}

export interface AnkorstoreVariantSnapshot {
  sku: string;
  wholesalePriceCents: number;
  retailPriceCents: number;
  stockQty: number;
  isAlwaysInStock: boolean;
  optionColor: string;
  optionSize: string;
}

export type AnkorstoreImagesSnapshot = {
  [colorKey: string]: { [slotKey: string]: string }; // local path
};

export type AnkorstoreStatus = "active" | "inactive" | "archived";

export interface AnkorstoreSyncSnapshot {
  schemaVersion: typeof ANKORSTORE_SNAPSHOT_VERSION;
  product: AnkorstoreProductFieldsSnapshot;
  variants: { [ankorsVariantId: string]: AnkorstoreVariantSnapshot };
  images: AnkorstoreImagesSnapshot;
  status: AnkorstoreStatus;
}

export interface AnkorstoreSyncDiff {
  productChanged: boolean;
  variantsChanged: string[];
  imagesToUpload: { colorKey: string; slot: number; path: string }[];
  imagesToDelete: { colorKey: string; slot: number }[];
  statusChanged: boolean;
}

export function productFieldsEqual(
  a: AnkorstoreProductFieldsSnapshot,
  b: AnkorstoreProductFieldsSnapshot,
): boolean {
  return (
    a.externalId === b.externalId &&
    a.name === b.name &&
    a.description === b.description &&
    a.vatRate === b.vatRate &&
    a.countryCode === b.countryCode &&
    a.unitMultiplier === b.unitMultiplier &&
    a.brandName === b.brandName &&
    a.weightGrams === b.weightGrams &&
    a.dimensionLengthMm === b.dimensionLengthMm &&
    a.dimensionWidthMm === b.dimensionWidthMm &&
    a.dimensionHeightMm === b.dimensionHeightMm &&
    a.hsCode === b.hsCode
  );
}

export function variantSnapshotEqual(
  a: AnkorstoreVariantSnapshot,
  b: AnkorstoreVariantSnapshot,
): boolean {
  return (
    a.sku === b.sku &&
    a.wholesalePriceCents === b.wholesalePriceCents &&
    a.retailPriceCents === b.retailPriceCents &&
    a.stockQty === b.stockQty &&
    a.isAlwaysInStock === b.isAlwaysInStock &&
    a.optionColor === b.optionColor &&
    a.optionSize === b.optionSize
  );
}

/**
 * Compare deux snapshots et retourne ce qui doit être renvoyé à Ankorstore.
 * Si `prev` est null (premier sync ou snapshot effacé), tout est marqué
 * comme à renvoyer.
 */
export function diffAnkorstoreSnapshots(
  prev: AnkorstoreSyncSnapshot | null,
  next: AnkorstoreSyncSnapshot,
): AnkorstoreSyncDiff {
  // Pas de snapshot précédent → tout est nouveau
  if (!prev || prev.schemaVersion !== ANKORSTORE_SNAPSHOT_VERSION) {
    const imagesToUpload: AnkorstoreSyncDiff["imagesToUpload"] = [];
    for (const [colorKey, slots] of Object.entries(next.images)) {
      for (const [slotKey, path] of Object.entries(slots)) {
        imagesToUpload.push({ colorKey, slot: Number(slotKey), path });
      }
    }
    return {
      productChanged: true,
      variantsChanged: Object.keys(next.variants),
      imagesToUpload,
      imagesToDelete: [],
      statusChanged: true,
    };
  }

  const productChanged = !productFieldsEqual(prev.product, next.product);
  const statusChanged = prev.status !== next.status;

  // Variants : seules celles présentes dans `next` peuvent être patchées.
  // Celles présentes dans `prev` mais plus dans `next` sont gérées séparément
  // (suppression Ankorstore) — on n'a rien à diffuser pour elles.
  const variantsChanged: string[] = [];
  for (const [vid, nextVariant] of Object.entries(next.variants)) {
    const prevVariant = prev.variants[vid];
    if (!prevVariant || !variantSnapshotEqual(prevVariant, nextVariant)) {
      variantsChanged.push(vid);
    }
  }

  // Images : compare slot par slot, par colorKey.
  const imagesToUpload: AnkorstoreSyncDiff["imagesToUpload"] = [];
  const imagesToDelete: AnkorstoreSyncDiff["imagesToDelete"] = [];

  // Slots à uploader : ceux qui n'existent pas dans prev OU dont le path diffère.
  for (const [colorKey, slots] of Object.entries(next.images)) {
    const prevSlots = prev.images[colorKey] ?? {};
    for (const [slotKey, path] of Object.entries(slots)) {
      if (prevSlots[slotKey] !== path) {
        imagesToUpload.push({ colorKey, slot: Number(slotKey), path });
      }
    }
  }

  // Slots à supprimer : ceux présents dans prev mais plus dans next.
  for (const [colorKey, prevSlots] of Object.entries(prev.images)) {
    const nextSlots = next.images[colorKey] ?? {};
    for (const slotKey of Object.keys(prevSlots)) {
      if (!(slotKey in nextSlots)) {
        imagesToDelete.push({ colorKey, slot: Number(slotKey) });
      }
    }
  }

  return {
    productChanged,
    variantsChanged,
    imagesToUpload,
    imagesToDelete,
    statusChanged,
  };
}

/**
 * Indique si le diff implique au moins un appel API Ankorstore.
 * Utile pour court-circuiter l'ensemble du flux quand rien n'a bougé.
 */
export function diffIsEmpty(diff: AnkorstoreSyncDiff): boolean {
  return (
    !diff.productChanged &&
    !diff.statusChanged &&
    diff.variantsChanged.length === 0 &&
    diff.imagesToUpload.length === 0 &&
    diff.imagesToDelete.length === 0
  );
}

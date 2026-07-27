/**
 * PFS Sync Diff — Compare un instantané du dernier état envoyé à PFS avec
 * l'état courant pour ne renvoyer que les changements lors d'un update.
 *
 * Le snapshot vit dans `Product.pfsLastSyncSnapshot` (JSON). Il est mis à
 * jour à la fin de chaque sync réussie. Quand `pfsLastSyncSnapshot` est null
 * (premier publish, ou refresh qui remplace le pfsProductId), on traite tout
 * comme "à envoyer".
 */

export const PFS_SNAPSHOT_VERSION = 1 as const;

export interface PfsProductFieldsSnapshot {
  reference: string;
  nameSource: string;
  descSource: string;
  dimensions: string;
  composition: { id: string; value: number }[];
  country: string;
  season: string;
  // NB : la marque (`brand_name` côté PFS) n'est volontairement pas dans le
  // snapshot. Elle est fixée à la création (publish/refresh) et n'est
  // jamais modifiée par la suite. Aucun update PATCH ne renvoie le champ
  // brand_name à PFS.
  gender: string;
  category: string | null;
  family: string | null;
  sizeDetailsTu: string | null;
}

export interface PfsVariantSnapshot {
  price: number;
  stock: number;
  weight: number;
  isActive: boolean;
  /**
   * Mapping PFS effectif de la variante (override secondaire en priorité, sinon
   * principal de la couleur). Optionnel pour compat des anciens snapshots — un
   * snapshot sans ce champ ne déclenchera pas de re-sync sur le simple ajout
   * du champ ; le diff verra "absent" et restera identique tant qu'on ne pose
   * pas un override.
   */
  colorRef?: string;
  /**
   * Type PFS effectif de la variante ("UNIT" côté BJ = "ITEM" côté PFS,
   * "PACK" identique). Optionnel pour compat rétro : un snapshot sans ce
   * champ ne déclenche PAS de recreate systématique — la logique de recreate
   * fait un fallback sur `pfsGetVariants` pour connaître le type réel.
   */
  saleType?: "UNIT" | "PACK";
  /**
   * Signature stable du contenu du pack : liste triée de "<colorRef>:<size>:<qty>"
   * jointe par "||". `null` pour une variante UNIT. Optionnel pour compat rétro
   * (mêmes règles que saleType : le fallback interroge PFS).
   */
  packSignature?: string | null;
}

export type PfsImagesSnapshot = {
  [colorRef: string]: { [slotKey: string]: string };
};

export interface PfsSyncSnapshot {
  schemaVersion: typeof PFS_SNAPSHOT_VERSION;
  product: PfsProductFieldsSnapshot;
  defaultColor: string | null;
  variants: { [pfsVariantId: string]: PfsVariantSnapshot };
  images: PfsImagesSnapshot;
  status: string;
  isBestSeller: boolean;
  /**
   * État du toggle « badge Référence » au moment du dernier push. Sert à
   * détecter un changement de toggle entre 2 syncs et forcer un re-upload
   * de la 1ère image de la couleur principale (le path DB étant inchangé,
   * la diff standard ne verrait rien). Optionnel pour rétro-compat.
   */
  brandedBadgeApplied?: boolean;
}

export interface PfsSyncDiff {
  productChanged: boolean;
  defaultColorChanged: boolean;
  variantsChanged: string[];
  imagesToUpload: { colorRef: string; slot: number; path: string }[];
  imagesToDelete: { colorRef: string; slot: number }[];
  statusChanged: boolean;
  bestSellerChanged: boolean;
}

function arraysEqualBy<T>(a: T[], b: T[], key: (x: T) => string): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(key).sort();
  const sb = [...b].map(key).sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

export function productFieldsEqual(
  a: PfsProductFieldsSnapshot,
  b: PfsProductFieldsSnapshot,
): boolean {
  return (
    a.reference === b.reference &&
    a.nameSource === b.nameSource &&
    a.descSource === b.descSource &&
    a.dimensions === b.dimensions &&
    a.country === b.country &&
    a.season === b.season &&
    a.gender === b.gender &&
    a.category === b.category &&
    a.family === b.family &&
    a.sizeDetailsTu === b.sizeDetailsTu &&
    arraysEqualBy(a.composition, b.composition, (c) => `${c.id}:${c.value}`)
  );
}

export function variantSnapshotEqual(
  a: PfsVariantSnapshot,
  b: PfsVariantSnapshot,
): boolean {
  // saleType et packSignature ne sont comparés que si les DEUX snapshots
  // les portent — sinon on tombe dans le cas "ancien snapshot pré-v1.1"
  // et le fallback pfsGetVariants côté pfs-update.ts décidera si un
  // recreate est nécessaire.
  const saleTypeComparable = a.saleType != null && b.saleType != null;
  const packSigComparable = a.packSignature !== undefined && b.packSignature !== undefined;
  return (
    a.price === b.price &&
    a.stock === b.stock &&
    a.weight === b.weight &&
    a.isActive === b.isActive &&
    (a.colorRef ?? null) === (b.colorRef ?? null) &&
    (!saleTypeComparable || a.saleType === b.saleType) &&
    (!packSigComparable || (a.packSignature ?? null) === (b.packSignature ?? null))
  );
}

/**
 * Compare deux snapshots et retourne ce qui doit être renvoyé à PFS.
 * Si `prev` est null (premier sync ou snapshot effacé), tout est marqué
 * comme à renvoyer.
 */
export function diffSnapshots(
  prev: PfsSyncSnapshot | null,
  next: PfsSyncSnapshot,
): PfsSyncDiff {
  // Pas de snapshot précédent → tout est nouveau
  if (!prev || prev.schemaVersion !== PFS_SNAPSHOT_VERSION) {
    const imagesToUpload: PfsSyncDiff["imagesToUpload"] = [];
    for (const [colorRef, slots] of Object.entries(next.images)) {
      for (const [slotKey, path] of Object.entries(slots)) {
        imagesToUpload.push({ colorRef, slot: Number(slotKey), path });
      }
    }
    return {
      productChanged: true,
      defaultColorChanged: true,
      variantsChanged: Object.keys(next.variants),
      imagesToUpload,
      imagesToDelete: [],
      statusChanged: true,
      bestSellerChanged: next.isBestSeller, // STAR si coché, REMOVE_STAR inutile (PFS crée sans étoile)
    };
  }

  const productChanged = !productFieldsEqual(prev.product, next.product);
  const defaultColorChanged = prev.defaultColor !== next.defaultColor;
  const statusChanged = prev.status !== next.status;
  const bestSellerChanged = prev.isBestSeller !== next.isBestSeller;

  // Variants : seules celles présentes dans `next` peuvent être patchées.
  // Celles présentes dans `prev` mais plus dans `next` sont gérées séparément
  // (suppression PFS) — on n'a rien à diffuser pour elles.
  const variantsChanged: string[] = [];
  for (const [vid, nextVariant] of Object.entries(next.variants)) {
    const prevVariant = prev.variants[vid];
    if (!prevVariant || !variantSnapshotEqual(prevVariant, nextVariant)) {
      variantsChanged.push(vid);
    }
  }

  // Images : compare slot par slot, par colorRef.
  const imagesToUpload: PfsSyncDiff["imagesToUpload"] = [];
  const imagesToDelete: PfsSyncDiff["imagesToDelete"] = [];

  // Slots à uploader : ceux qui n'existent pas dans prev OU dont le path diffère.
  for (const [colorRef, slots] of Object.entries(next.images)) {
    const prevSlots = prev.images[colorRef] ?? {};
    for (const [slotKey, path] of Object.entries(slots)) {
      if (prevSlots[slotKey] !== path) {
        imagesToUpload.push({ colorRef, slot: Number(slotKey), path });
      }
    }
  }

  // Slots à supprimer : ceux présents dans prev mais plus dans next.
  for (const [colorRef, prevSlots] of Object.entries(prev.images)) {
    const nextSlots = next.images[colorRef] ?? {};
    for (const slotKey of Object.keys(prevSlots)) {
      if (!(slotKey in nextSlots)) {
        imagesToDelete.push({ colorRef, slot: Number(slotKey) });
      }
    }
  }

  return {
    productChanged,
    defaultColorChanged,
    variantsChanged,
    imagesToUpload,
    imagesToDelete,
    statusChanged,
    bestSellerChanged,
  };
}

/**
 * Indique si le diff implique au moins un appel API PFS.
 * Utile pour court-circuiter l'ensemble du flux quand rien n'a bougé.
 */
export function diffIsEmpty(diff: PfsSyncDiff): boolean {
  return (
    !diff.productChanged &&
    !diff.defaultColorChanged &&
    !diff.statusChanged &&
    !diff.bestSellerChanged &&
    diff.variantsChanged.length === 0 &&
    diff.imagesToUpload.length === 0 &&
    diff.imagesToDelete.length === 0
  );
}

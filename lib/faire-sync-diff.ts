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
// v6 : sépare le diff des images de celui des autres champs (productImagesChanged
// + variantsImagesChanged) pour éviter de re-pousser systématiquement les images
// dans le PATCH. Faire déduplique les images par contenu : envoyer la même URL à
// la racine ET sur une variante déclenche « 2 images principales » (HTTP 400).
// Conséquence : sur un snapshot null (post-reset), on N'ENVOIE PLUS les images
// dans le PATCH par défaut — l'état Faire est gardé tel quel. Pour forcer un
// re-upload (bouton « Synchroniser » = resynchro complète), passer
// `options.forceImages: true` à `diffSnapshots` : le flow update prendra alors
// soin de DELETE les images côté Faire avant le PATCH pour éviter le doublon.
export const FAIRE_SNAPSHOT_VERSION = 6 as const;

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
  /**
   * ID Faire `po_xxx` de la variante. Indispensable pour la suppression :
   * quand une variante est retirée localement, l'enregistrement BDD est
   * supprimé et seul le snapshot peut nous dire quel ID Faire appeler en
   * DELETE. Optional pour rétro-compat avec les snapshots écrits avant
   * l'ajout du champ (juin 2026) — dans ce cas, le flow update bascule sur
   * un fetch Faire en fallback.
   */
  faireVariantId?: string | null;
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
  /**
   * Images racine du produit. Séparé de `productChanged` car Faire refuse de
   * « re-PATCH » des images déjà présentes (déduplication par contenu → erreur
   * « 2 images principales »). On n'inclut donc `images` dans le PATCH que
   * lorsque ce flag est vrai. Toujours `false` quand `prev` est null (snapshot
   * inexistant), pour ne pas écraser l'état Faire au premier sync post-reset.
   */
  productImagesChanged: boolean;
  variantsChanged: string[];
  /**
   * SKU des variantes dont les images ont changé. Même règle que
   * `productImagesChanged` : on n'envoie `images` au PATCH variant que pour
   * ces SKU. Toujours vide quand `prev` est null.
   */
  variantsImagesChanged: string[];
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

/**
 * Compare les champs « méta » du produit (tout sauf les images racine).
 * Séparé de la comparaison d'images : on veut savoir si on doit PATCH la
 * fiche pour son nom/description/… sans forcément re-pousser les images.
 */
export function productMetaEqual(
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
    a.perStyleMinimumOrderQuantity === b.perStyleMinimumOrderQuantity
  );
}

/** Compatibilité avec les tests/imports anciens (= méta + images). */
export function productFieldsEqual(
  a: FaireProductFieldsSnapshot,
  b: FaireProductFieldsSnapshot,
): boolean {
  return productMetaEqual(a, b) && stringListEqual(a.images, b.images);
}

export interface VariantDiffDetail {
  inventoryChanged: boolean;
  pricesChanged: boolean;
  /** Tous les autres champs (couleur/active/mesures/tariff) HORS images. */
  otherChanged: boolean;
  /** Les images de la variante ont changé (séparé pour le PATCH conditionnel). */
  imagesChanged: boolean;
}

export function diffVariantSnapshot(
  prev: FaireVariantSnapshot,
  next: FaireVariantSnapshot,
): VariantDiffDetail {
  const inventoryChanged = prev.availableQuantity !== next.availableQuantity;
  const pricesChanged =
    prev.wholesalePriceCents !== next.wholesalePriceCents ||
    prev.retailPriceCents !== next.retailPriceCents;
  const imagesChanged = !stringListEqual(prev.images, next.images);
  const otherChanged =
    prev.colorOption !== next.colorOption ||
    prev.active !== next.active ||
    prev.weightGrams !== next.weightGrams ||
    prev.lengthCm !== next.lengthCm ||
    prev.widthCm !== next.widthCm ||
    prev.heightCm !== next.heightCm ||
    prev.tariffCode !== next.tariffCode;
  return { inventoryChanged, pricesChanged, otherChanged, imagesChanged };
}

export function diffSnapshots(
  prev: FaireSyncSnapshot | null,
  next: FaireSyncSnapshot,
  options?: { forceImages?: boolean },
): FaireSyncDiff {
  if (!prev || prev.schemaVersion !== FAIRE_SNAPSHOT_VERSION) {
    // Snapshot inexistant ou périmé : tout est considéré comme à pousser.
    // Cas des images :
    //   - défaut : on NE renvoie PAS les images (`productImagesChanged=false`,
    //     `variantsImagesChanged=[]`). Faire déduplique par contenu et refuse
    //     les re-uploads (« 2 images principales »).
    //   - `options.forceImages=true` : cas du bouton « Synchroniser » /
    //     resynchro forcée demandée par l'admin. Le flow update DELETE les
    //     images existantes côté Faire avant le PATCH pour éviter le doublon,
    //     puis renvoie les nouvelles URLs — c'est le seul moyen de propager
    //     un ajout ou une modification d'image depuis l'admin.
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
  // `productChanged` reste vrai si méta OU images ont changé — c'est ce flag
  // que buildPatchBody utilise pour décider d'inclure les champs non-image
  // (name, description, etc.). Le sous-flag `productImagesChanged` gouverne
  // l'inclusion conditionnelle des images.
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
      // Variante ajoutée : ses images doivent être envoyées au PATCH consolidé
      // (Faire les attend dans le payload variant à la création).
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

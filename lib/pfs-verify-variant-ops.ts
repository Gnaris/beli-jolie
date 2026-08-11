/**
 * PFS Verify — opérations atomiques sur variantes (couleurs) d'un produit.
 *
 * Introduit 2026-07-24 pour permettre à la modale d'écarts PFS d'agir sur les
 * variantes manquantes / en trop :
 *
 *   - `pushAddPfsVariantFromLocal(productId, colorRef)` — publie sur PFS une
 *     variante déjà présente chez nous : `pfsCreateVariants` + upload photos
 *     JPEG. Écrit `ProductColor.pfsVariantId` en retour.
 *   - `pushRemovePfsVariant(pfsVariantId)` — appel direct `pfsDeleteVariant`,
 *     rien à faire côté BDD locale (la variante n'existe pas chez nous).
 *   - `pullAddLocalVariantFromPfs(productId, pfsVariantId)` — importe chez
 *     nous une variante PFS orpheline : résout Color/Sizes locales (créées si
 *     nécessaire), télécharge JPEG PFS → WebP local, crée `ProductColor`
 *     + `VariantSize` (UNIT) ou `PackColorLine` (PACK mono/multi couleurs).
 *   - `pullRemoveLocalVariant(productId, colorRef)` — supprime la
 *     `ProductColor` locale (cascade Prisma). Refuse si déjà commandée
 *     (préserve l'intégrité comptable).
 *
 * Ce module ne connaît RIEN de la modale ni du worker marketplace — c'est
 * `lib/pfs-verify-apply.ts` qui l'appelle une fois pour chaque action
 * autorisée.
 */

import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  pfsCheckReference,
  pfsGetVariants,
  type PfsVariantDetail,
  type PfsVariantItem,
} from "@/lib/pfs-api";
import {
  pfsCreateVariants,
  pfsDeleteVariant,
  pfsUploadImage,
  pfsGetColors,
  type PfsVariantCreateData,
} from "@/lib/pfs-api-write";
import {
  loadMarketplaceMarkupConfigs,
  applyMarketplaceMarkup,
  type MarkupConfig,
} from "@/lib/marketplace-pricing";
import { logger } from "@/lib/logger";
import {
  resolveVariant,
  downloadAllVariantImagesToBuffers,
  type ResolvedVariant,
} from "@/lib/pfs-import";
import { loadPfsImportPriceMarkup, applyImportMarkupToUnitPrice } from "@/lib/pfs-import-price-markup";
import { processProductImage } from "@/lib/image-processor";
import { productImageDir, productImageBaseName } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { generateSku } from "@/lib/sku";

// ─── Résultats publics ─────────────────────────────────────────────────────

export type VariantOpResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

// ═══════════════════════════════════════════════════════════════════════════
// 1) PUSH — ajouter une variante locale sur PFS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publie sur PFS la variante (couleur) locale identifiée par `colorRef`. Si
 * elle a déjà un `pfsVariantId` non nul, on la considère comme déjà publiée
 * et on lève une erreur — la modale ne devrait pas nous laisser arriver ici.
 */
export async function pushAddPfsVariantFromLocal(
  productId: string,
  colorRef: string,
  variantType: "UNIT" | "PACK",
): Promise<VariantOpResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      pfsProductId: true,
      colors: {
        select: {
          id: true,
          pfsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          disabled: true,
          colorId: true,
          color: { select: { id: true, name: true, hex: true, pfsColorRef: true } },
          pfsColorRefOverride: true,
          variantSizes: {
            select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
          },
          packLines: {
            select: {
              colorId: true,
              color: { select: { id: true, name: true, hex: true, pfsColorRef: true } },
              position: true,
              pfsColorRefOverride: true,
              sizes: {
                select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
              },
            },
            orderBy: { position: "asc" },
          },
          images: {
            select: { path: true, order: true, colorId: true },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });

  if (!product) return { ok: false, error: "Produit introuvable." };
  if (!product.pfsProductId) return { ok: false, error: "Produit non publié sur PFS." };

  const [colorRefMap, markupConfigs] = await Promise.all([
    buildColorLabelToRefMap(),
    loadMarketplaceMarkupConfigs(),
  ]);
  const markup = markupConfigs.pfs;

  const local = product.colors.find(
    (c) =>
      c.saleType === variantType &&
      normalizeColorRef(effectiveColorRef(c, colorRefMap)) === normalizeColorRef(colorRef),
  );
  if (!local) {
    return {
      ok: false,
      error: `Aucune variante locale ${variantType} pour la couleur ${colorRef}.`,
    };
  }
  if (local.pfsVariantId) {
    return {
      ok: false,
      error: `La variante ${colorRef} est déjà liée à PFS (${local.pfsVariantId}).`,
    };
  }

  const createData = buildPfsVariantCreatePayload(local, colorRefMap, markup);
  if (!createData) {
    return { ok: false, error: `Impossible de construire les données PFS pour ${colorRef}.` };
  }

  logger.info("[PFS Verify Ops] Push add variant", {
    productId,
    pfsProductId: product.pfsProductId,
    colorRef,
    variantType,
  });

  const { variantIds } = await pfsCreateVariants(product.pfsProductId, [createData]);
  const newPfsVariantId = variantIds[0];
  if (!newPfsVariantId) {
    return { ok: false, error: `PFS n'a pas retourné d'identifiant pour la variante ${colorRef}.` };
  }

  await prisma.productColor.update({
    where: { id: local.id },
    data: { pfsVariantId: newPfsVariantId },
  });

  // Upload des photos de la couleur — même logique que pfsPublishProduct :
  // on lit le WebP local, on le convertit en JPEG chromaSubsampling 4:4:4,
  // on upload via multipart. Le colorRef fourni à PFS est celui du variant
  // create, pour rester cohérent avec ce que PFS attend en clé.
  const primaryColorId = local.colorId;
  const imagesForColor = primaryColorId
    ? local.images.filter((img) => img.colorId === primaryColorId).sort((a, b) => a.order - b.order)
    : [];

  let uploaded = 0;
  let failed = 0;
  for (let i = 0; i < imagesForColor.length; i++) {
    const img = imagesForColor[i];
    const slot = i + 1;
    try {
      const jpegBuffer = await webpPathToJpegBuffer(img.path);
      await pfsUploadImage(product.pfsProductId, jpegBuffer, slot, createData.color, `image_${slot}.jpg`);
      uploaded++;
    } catch (err) {
      failed++;
      logger.warn("[PFS Verify Ops] Image upload failed", {
        productId,
        colorRef,
        slot,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    message: `Variante ${colorRef} ajoutée sur PFS (${uploaded}/${imagesForColor.length} photos)${failed > 0 ? ` — ${failed} échec(s)` : ""}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) PUSH — retirer une variante de PFS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supprime définitivement une variante sur PFS. Aucun impact BDD locale : la
 * variante n'existe déjà plus chez nous (c'est justement pour ça que la modale
 * la marque comme « en trop côté PFS »).
 */
export async function pushRemovePfsVariant(pfsVariantId: string): Promise<VariantOpResult> {
  logger.info("[PFS Verify Ops] Push remove variant", { pfsVariantId });
  try {
    await pfsDeleteVariant(pfsVariantId);
    return { ok: true, message: "Variante retirée de PFS." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) PULL — importer une variante PFS chez nous
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère la variante PFS `pfsVariantId` et la matérialise chez nous en
 * `ProductColor` rattachée au produit `productId`. Utilise les mêmes helpers
 * que l'import complet (`resolveVariant` + `downloadAllVariantImagesToBuffers`
 * + `processProductImage`) pour garantir un rendu identique — Color/Size créés
 * à la volée si manquants, photos JPEG PFS converties en WebP local avec le
 * même pipeline que l'import.
 *
 * Marque `ankorsSyncRequired` / `efashionSyncRequired` / `faireSyncRequired` :
 * la nouvelle couleur n'existant pas encore sur ces marketplaces, elles
 * doivent être resynchronisées pour la propager.
 */
export async function pullAddLocalVariantFromPfs(
  productId: string,
  pfsVariantId: string,
): Promise<VariantOpResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      colors: {
        select: {
          id: true,
          saleType: true,
          colorId: true,
          color: { select: { id: true, name: true, pfsColorRef: true } },
          pfsColorRefOverride: true,
        },
      },
    },
  });
  if (!product) return { ok: false, error: "Produit introuvable." };
  if (!product.pfsProductId) return { ok: false, error: "Produit non publié sur PFS." };

  logger.info("[PFS Verify Ops] Pull add variant — start", {
    productId,
    reference: product.reference,
    pfsVariantId,
  });

  // Récupération de l'état PFS complet pour trouver la variante ciblée.
  // On charge aussi checkRef pour disposer des images produit (fallback quand
  // `pfsGetVariants` renvoie une variante sans `images` — ce qui arrive
  // fréquemment sur les couleurs importées avant l'ajout du champ variant.
  // Sans ce fallback, la nouvelle variante était créée sans aucune photo).
  const [variantsResp, checkRef] = await Promise.all([
    pfsGetVariants(product.pfsProductId),
    pfsCheckReference(product.reference),
  ]);
  const pfsVariants: PfsVariantDetail[] = variantsResp.data ?? [];
  const pv = pfsVariants.find((v) => v.id === pfsVariantId);
  if (!pv) {
    return {
      ok: false,
      error: `Variante ${pfsVariantId} introuvable côté PFS — peut-être déjà supprimée.`,
    };
  }
  const productImages = checkRef?.product?.images ?? {};

  const warnings: string[] = [];
  const rv = await resolveVariant(pv as PfsVariantItem, warnings, productImages);
  if (!rv) {
    return { ok: false, error: `Résolution PFS impossible pour la variante ${pfsVariantId}.` };
  }

  // Filet de sécurité : refuser si la variante existe déjà en base (cas de
  // doublon accidentel). On compare (colorId, saleType) parce que 1 même
  // couleur peut co-exister en UNIT et PACK — les deux sont légitimes.
  const clash = product.colors.find(
    (c) => c.colorId === rv.colorId && c.saleType === rv.saleType,
  );
  if (clash) {
    return {
      ok: false,
      error: `Une variante ${rv.saleType} existe déjà chez nous pour cette couleur — resynchronisez d'abord.`,
    };
  }

  const importPriceMarkup = await loadPfsImportPriceMarkup();

  // Téléchargement des photos (3 passes HTTP → Chromium A → Chromium B). On
  // wrappe dans un try/catch — si les photos ne peuvent pas être obtenues,
  // on crée quand même la variante sans image (l'admin pourra les ajouter
  // manuellement). Cas moins invasif que d'échouer sur l'import entier.
  const colorNames = new Map<string, string>();
  const colorName = pv.item?.color.labels?.fr
    ?? pv.item?.color.reference
    ?? pv.packs?.[0]?.color.labels?.fr
    ?? pv.packs?.[0]?.color.reference
    ?? "COLOR";
  for (const cid of rv.allColorIds.length > 0 ? rv.allColorIds : [rv.colorId]) {
    colorNames.set(cid, colorName);
  }

  const localVariantIdPlaceholder = `pull-${pfsVariantId}`;
  let downloaded: Awaited<ReturnType<typeof downloadAllVariantImagesToBuffers>> = [];
  try {
    downloaded = await downloadAllVariantImagesToBuffers(
      product.pfsProductId,
      product.reference,
      colorNames,
      [{ id: localVariantIdPlaceholder, colorId: rv.colorId, pfsVariant: rv }],
    );
  } catch (err) {
    logger.warn("[PFS Verify Ops] Image download failed — creating variant without images", {
      productId,
      pfsVariantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Traitement local (JPEG → WebP + 3 tailles) via le même pipeline que
  // l'import produit. Chaque image passée devient un `dbPath` définitif.
  const tenant = await requireCurrentTenant();
  const destDir = `public/${productImageDir(product.reference, tenant.slug)}`;
  const processedImages: { colorId: string; order: number; dbPath: string }[] = [];
  for (const di of downloaded) {
    try {
      const filename = productImageBaseName(product.reference, colorName, di.img.order + 1);
      const { dbPath } = await processProductImage(di.body, destDir, filename);
      processedImages.push({ colorId: di.img.colorId, order: di.img.order, dbPath });
    } catch (err) {
      logger.warn("[PFS Verify Ops] Image processing failed", {
        productId,
        colorId: di.img.colorId,
        order: di.img.order,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const skuColorIds = rv.allColorIds.length > 0 ? rv.allColorIds : [rv.colorId];
  const skuColorNames = skuColorIds.map((id) => colorNames.get(id) ?? "COLOR");
  const nextIndex = product.colors.length + 1;
  const sku = generateSku(product.reference, skuColorNames, rv.saleType, nextIndex);

  const otherMarketplaceFlags: Prisma.ProductUpdateInput = {};
  if (product.ankorsProductId) otherMarketplaceFlags.ankorsSyncRequired = true;
  if (product.efashionReferenceBase) otherMarketplaceFlags.efashionSyncRequired = true;
  if (product.faireProductId) otherMarketplaceFlags.faireSyncRequired = true;

  await prisma.$transaction(async (tx) => {
    // On pose `pfsColorRefOverride` sur la nouvelle ProductColor et on backfill
    // `pfsColorRef` sur la Color locale si elle n'en a pas encore. Sans ça,
    // l'audit suivant peut reproposer l'ajout de la même couleur : le compare
    // matche variante par colorRef normalisé, or si la Color locale (retrouvée
    // par nom via `resolveColorIdForPfsInfo`) n'a pas de `pfsColorRef` et que
    // la table de labels PFS ne connaît pas ce nom, le fallback retombe sur
    // `color.name` (ex: « Jaune ») qui ne matche pas la ref PFS (ex: « YELLOW »).
    const pfsColorRefFromVariant = rv.primaryPfsColorRef?.trim() || null;
    const variantRow = await tx.productColor.create({
      data: {
        productId,
        colorId: rv.colorId,
        unitPrice: applyImportMarkupToUnitPrice(rv.unitPrice, rv.packQuantity, importPriceMarkup),
        weight: rv.weight,
        stock: rv.stock,
        isPrimary: false,
        saleType: rv.saleType,
        packQuantity: rv.packQuantity,
        sku,
        pfsVariantId: rv.pfsVariantId,
        pfsColorRefOverride: pfsColorRefFromVariant,
      },
      select: { id: true },
    });
    if (pfsColorRefFromVariant) {
      const localColor = await tx.color.findUnique({
        where: { id: rv.colorId },
        select: { pfsColorRef: true },
      });
      if (localColor && !localColor.pfsColorRef) {
        await tx.color.update({
          where: { id: rv.colorId },
          data: { pfsColorRef: pfsColorRefFromVariant },
        });
      }
    }

    if (rv.packLines.length > 0) {
      for (let li = 0; li < rv.packLines.length; li++) {
        const line = rv.packLines[li];
        await tx.packColorLine.create({
          data: {
            productColorId: variantRow.id,
            colorId: line.colorId,
            position: li,
            sizes: {
              create: line.sizeEntries.map((se) => ({
                sizeId: se.sizeId,
                quantity: se.quantity,
              })),
            },
          },
        });
      }
    } else if (rv.sizeEntries.length > 0) {
      await tx.variantSize.createMany({
        data: rv.sizeEntries.map((se) => ({
          productColorId: variantRow.id,
          sizeId: se.sizeId,
          quantity: se.quantity,
        })),
      });
    }

    if (processedImages.length > 0) {
      // `skipDuplicates` évite le crash quand la couleur importée a déjà des
      // photos locales sur les mêmes ordres — cas typique : image orpheline
      // laissée par un ancien variant, ou même couleur portée par un autre
      // saleType. La contrainte unique est (productId, colorId, order) ; les
      // photos existantes restent visibles pour la nouvelle variante puisque
      // l'affichage se fait par colorId.
      await tx.productColorImage.createMany({
        data: processedImages.map((pi) => ({
          productId,
          colorId: pi.colorId,
          productColorId: variantRow.id,
          path: pi.dbPath,
          order: pi.order,
        })),
        skipDuplicates: true,
      });
    }

    if (Object.keys(otherMarketplaceFlags).length > 0) {
      await tx.product.update({
        where: { id: productId },
        data: { ...otherMarketplaceFlags, pfsSyncRequired: false, pfsLastSyncSnapshot: Prisma.DbNull },
      });
    } else {
      await tx.product.update({
        where: { id: productId },
        data: { pfsSyncRequired: false, pfsLastSyncSnapshot: Prisma.DbNull },
      });
    }
  }, { timeout: 30000 });

  logger.info("[PFS Verify Ops] Pull add variant — done", {
    productId,
    reference: product.reference,
    pfsVariantId,
    localColorId: rv.colorId,
    saleType: rv.saleType,
    imagesCount: processedImages.length,
  });

  return {
    ok: true,
    message: `Variante importée depuis PFS (${processedImages.length} photo${processedImages.length > 1 ? "s" : ""}).`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4) PULL — retirer une variante locale
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supprime une `ProductColor` locale (identifiée par `colorRef` + `variantType`)
 * ainsi que ses relations en cascade (VariantSize, PackColorLine, images,
 * CartItem). Refuse si des OrderItem historiques référencent cette variante
 * — la traçabilité comptable prime sur la propreté du catalogue.
 */
export async function pullRemoveLocalVariant(
  productId: string,
  colorRef: string,
  variantType: "UNIT" | "PACK",
): Promise<VariantOpResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      colors: {
        select: {
          id: true,
          saleType: true,
          colorId: true,
          color: { select: { name: true, pfsColorRef: true } },
          pfsColorRefOverride: true,
        },
      },
    },
  });
  if (!product) return { ok: false, error: "Produit introuvable." };

  const colorRefMap = await buildColorLabelToRefMap();
  const local = product.colors.find(
    (c) =>
      c.saleType === variantType &&
      normalizeColorRef(effectiveColorRef(c, colorRefMap)) === normalizeColorRef(colorRef),
  );
  if (!local) {
    return {
      ok: false,
      error: `Variante ${colorRef} (${variantType}) introuvable chez nous.`,
    };
  }

  // Vérif intégrité comptable : refuser si historique de commande. On teste
  // les 4 tables susceptibles de référencer une ProductColor.
  const [ordered, pfsOrdered, efashionOrdered, ankorsOrdered] = await Promise.all([
    prisma.orderItem.count({ where: { productColorId: local.id } }),
    prisma.pfsOrderItem.count({ where: { productColorId: local.id } }),
    prisma.efashionOrderItem.count({ where: { productColorId: local.id } }),
    prisma.ankorstoreOrderItem.count({ where: { productColorId: local.id } }),
  ]);
  const totalOrders = ordered + pfsOrdered + efashionOrdered + ankorsOrdered;
  if (totalOrders > 0) {
    return {
      ok: false,
      error: `Impossible de retirer ${colorRef} chez nous : ${totalOrders} commande(s) référencent cette variante. Désactivez-la ou archivez le produit à la place.`,
    };
  }

  const otherMarketplaceFlags: Prisma.ProductUpdateInput = {};
  if (product.ankorsProductId) otherMarketplaceFlags.ankorsSyncRequired = true;
  if (product.efashionReferenceBase) otherMarketplaceFlags.efashionSyncRequired = true;
  if (product.faireProductId) otherMarketplaceFlags.faireSyncRequired = true;

  await prisma.$transaction(async (tx) => {
    // Cascade Prisma existante : ProductColor onDelete: Cascade sur
    // VariantSize/PackColorLine/ProductColorImage. CartItem est en Cascade
    // via variantId. Panier persistant : on nettoie explicitement pour être
    // safe si le schéma n'a pas de cascade dessus.
    await tx.cartItem.deleteMany({ where: { variantId: local.id } });
    await tx.productColor.delete({ where: { id: local.id } });

    await tx.product.update({
      where: { id: productId },
      data: { ...otherMarketplaceFlags, pfsSyncRequired: false, pfsLastSyncSnapshot: Prisma.DbNull },
    });
  }, { timeout: 15000 });

  return { ok: true, message: `Variante ${colorRef} retirée chez nous.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers internes
// ═══════════════════════════════════════════════════════════════════════════

async function buildColorLabelToRefMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const pfsColors = await pfsGetColors();
    for (const c of pfsColors) {
      const frLabel = c.labels?.fr?.trim();
      if (frLabel) map.set(frLabel, c.reference);
      map.set(c.reference, c.reference);
    }
  } catch (err) {
    logger.warn("[PFS Verify Ops] Failed to load PFS color references", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return map;
}

function effectiveColorRef(
  c: {
    pfsColorRefOverride: string | null;
    color: { name: string; pfsColorRef: string | null } | null;
  },
  colorRefMap: Map<string, string>,
): string {
  if (c.pfsColorRefOverride?.trim()) return c.pfsColorRefOverride.trim();
  if (c.color?.pfsColorRef) return c.color.pfsColorRef;
  if (c.color?.name) return colorRefMap.get(c.color.name) ?? c.color.name;
  return "";
}

function normalizeColorRef(ref: string): string {
  return ref
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

const getSizeRef = (vs: { size: { name: string; pfsSizeRef: string | null } }) =>
  vs.size.pfsSizeRef || vs.size.name || "TU";

/**
 * Construit la charge utile PFS create-variant depuis une ProductColor locale.
 * Reproduit la logique de `buildVariantCreateData` (pfs-update.ts) — dupliquée
 * pour ne pas exposer FullVariant/pfs-update en dépendance publique. Support
 * UNIT + PACK mono-couleur (variantSizes) + PACK multi-couleurs (packLines).
 */
function buildPfsVariantCreatePayload(
  variant: {
    unitPrice: unknown;
    weight: number;
    stock: number;
    saleType: string;
    packQuantity: number | null;
    disabled: boolean;
    colorId: string | null;
    color: { name: string; hex: string | null; pfsColorRef: string | null } | null;
    pfsColorRefOverride: string | null;
    variantSizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
    packLines: {
      color: { name: string; pfsColorRef: string | null };
      position: number;
      pfsColorRefOverride: string | null;
      sizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
    }[];
  },
  colorRefMap: Map<string, string>,
  markup: MarkupConfig | undefined,
): PfsVariantCreateData | null {
  const isActive = !variant.disabled;
  const rawPrice = Number(variant.unitPrice);
  const qty = variant.saleType === "PACK" && variant.packQuantity ? variant.packQuantity : 1;
  const unitBase = variant.saleType === "PACK" ? Math.round((rawPrice / qty) * 100) / 100 : rawPrice;
  const unitPrice = markup ? applyMarketplaceMarkup(unitBase, markup) : unitBase;

  if (variant.saleType === "UNIT") {
    if (!variant.color) return null;
    const colorRef = effectiveColorRef(variant, colorRefMap);
    if (!colorRef) return null;
    const sizeRef = variant.variantSizes[0] ? getSizeRef(variant.variantSizes[0]) : "TU";
    return {
      type: "ITEM",
      color: colorRef,
      size: sizeRef,
      price_eur_ex_vat: unitPrice,
      weight: variant.weight,
      stock_qty: variant.stock ?? 0,
      is_active: isActive,
    };
  }

  if (variant.saleType === "PACK") {
    const packEntries: { color: string; size: string; qty: number }[] = [];
    let firstColorRef: string | null = null;
    let firstSizeRef = "TU";

    if (variant.packLines.length > 0) {
      for (const pl of variant.packLines) {
        if (!pl.color?.name) continue;
        const plColorRef = pl.pfsColorRefOverride?.trim()
          || pl.color.pfsColorRef
          || colorRefMap.get(pl.color.name)
          || pl.color.name;
        if (!firstColorRef) firstColorRef = plColorRef;
        if (pl.sizes.length > 0) {
          for (const ps of pl.sizes) {
            const sizeRef = getSizeRef(ps);
            if (firstSizeRef === "TU") firstSizeRef = sizeRef;
            packEntries.push({ color: plColorRef, size: sizeRef, qty: ps.quantity });
          }
        } else {
          packEntries.push({ color: plColorRef, size: "TU", qty: variant.packQuantity ?? 1 });
        }
      }
    } else if (variant.color?.name) {
      firstColorRef = effectiveColorRef(variant, colorRefMap);
      if (!firstColorRef) return null;
      const sizesList = variant.variantSizes.length > 0
        ? variant.variantSizes
        : [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: variant.packQuantity ?? 1 }];
      for (const vs of sizesList) {
        const sizeRef = getSizeRef(vs);
        if (firstSizeRef === "TU") firstSizeRef = sizeRef;
        packEntries.push({ color: firstColorRef, size: sizeRef, qty: vs.quantity });
      }
    }

    if (!firstColorRef || packEntries.length === 0) return null;

    return {
      type: "PACK",
      color: firstColorRef,
      size: firstSizeRef,
      price_eur_ex_vat: unitPrice,
      weight: variant.weight,
      stock_qty: variant.stock ?? 0,
      is_active: isActive,
      packs: packEntries,
    };
  }

  return null;
}

/**
 * Convertit un chemin d'image (dbPath, ex: /uploads/beliandjolie/produits/…webp)
 * en buffer JPEG prêt pour l'upload PFS. Réutilise `sharp` avec les mêmes
 * réglages que `pfs-publish` (qualité 100, chroma 4:4:4, mozjpeg) pour un
 * rendu identique côté PFS.
 */
async function webpPathToJpegBuffer(dbPath: string): Promise<Buffer> {
  const { readFile, keyFromDbPath } = await import("@/lib/storage");
  const buffer = await readFile(keyFromDbPath(dbPath));
  return sharp(buffer)
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

// Re-export pour testabilité et usage externe éventuel.
export {
  buildColorLabelToRefMap,
  buildPfsVariantCreatePayload,
  normalizeColorRef,
  effectiveColorRef,
};

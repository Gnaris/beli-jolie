"use server";

/**
 * Paris Fashion Shop — Server actions pour la liaison manuelle.
 *
 * Permet de relier manuellement un produit BJ à un produit existant côté PFS
 * (sans le republier). Flux UI (style eFashion) :
 *   1. previewPfsMatchByReference(productId, ref?) → liste les variantes PFS
 *      correspondant à la référence + suggère un mapping couleur ↔ variante.
 *   2. linkPfsProductManually(productId, pfsProductId, brand, links) → écrit
 *      pfsProductId + chaque ProductColor.pfsVariantId, puis lance une sync
 *      best-effort pour aligner stock/prix/visibilité.
 *   3. removePfsMatch(productId) → délie tout côté BDD (PFS reste inchangé).
 */

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  pfsCheckReference,
  pfsGetVariants,
  type PfsVariantDetail,
} from "@/lib/pfs-api";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export interface PfsLinkCandidate {
  /** ID PFS de la variante (string opaque). */
  pfsVariantId: string;
  /** Type PFS : ITEM (vente à l'unité) ou PACK (vente en lot). */
  type: "ITEM" | "PACK";
  /** Couleur PFS — id numérique de la bibliothèque PFS. */
  pfsColorId: number;
  /** Référence interne PFS de la couleur (ex: "GOLDEN"). */
  pfsColorRef: string;
  /** Libellé FR de la couleur. */
  pfsColorName: string;
  /** Code hex de la couleur PFS. */
  pfsColorHex: string;
  /** Aperçu de la couleur (motif PFS, peut être null). */
  pfsColorImage: string | null;
  /** Libellé taille (ex: "TU", "S"). Pour un PACK : "PACK x N" (pour compat). */
  sizeLabel: string;
  /** Liste des vraies tailles du paquet pour un PACK (ex: ["S", "M", "L"]). Vide pour un ITEM. */
  packSizes: string[];
  /** Prix unité (EUR HT, ce que PFS reçoit). */
  priceUnit: number;
  /** Prix total (paquet complet) EUR HT — pour un PACK. Pour un ITEM : identique à priceUnit. */
  priceTotal: number;
  /** Nombre d'articles dans le paquet (null pour ITEM/UNIT). */
  packQuantity: number | null;
  /** Quantité en stock côté PFS. */
  stockQty: number;
  /** Poids PFS en kg (0 si absent). */
  weightKg: number;
  /** Visible/active côté PFS. */
  isActive: boolean;
  /** Première image de la variante (URL publique PFS). */
  imageUrl: string | null;
  /** ProductColor.id BJ pré-suggéré par matching nom (peut être null). */
  suggestedLocalColorId: string | null;
}

export interface PfsLinkLocalColor {
  /** ProductColor.id BJ (clé du mapping). */
  productColorId: string;
  /** Color.id BJ. */
  colorId: string;
  /** Libellé couleur. */
  name: string;
  hex: string | null;
  patternImage: string | null;
  saleType: "UNIT" | "PACK";
  /** Aperçu (1ʳᵉ image de la variante BJ, peut être null). */
  productImage: string | null;
  /** Prix unitaire BJ (pour UNIT) ou prix total (pour PACK). */
  unitPrice: number;
  /** Nombre d'articles dans le paquet (null pour UNIT). */
  packQuantity: number | null;
  /** Libellés de tailles vendues pour cette couleur (ex: ["S", "M", "L"] ou ["TU"]). */
  sizes: string[];
  /** Stock BJ pour cette variante. */
  stock: number;
  /** Poids BJ en kg. */
  weightKg: number;
  /** Référence PFS de couleur déjà mappée chez nous (Color.pfsColorRef). */
  existingPfsColorRef: string | null;
}

export interface PfsLinkPreview {
  productId: string;
  productName: string;
  reference: string;
  /** Référence PFS interrogée (ce que l'utilisatrice a tapé ou la liaison
   *  existante / la référence BJ par défaut). */
  pfsReference: string;
  /** ID PFS du produit trouvé (null si pas trouvé). */
  pfsProductId: string | null;
  /** Nom du produit côté PFS (label FR). */
  pfsProductName: string | null;
  /** Marque PFS du produit (renseignée à la liaison). */
  pfsBrandId: string | null;
  pfsBrandName: string | null;
  /** Aperçu produit PFS (1ʳᵉ image principale). */
  pfsProductImage: string | null;
  /** Toutes les ProductColor du produit BJ — toutes liables (PFS gère UNIT et PACK). */
  localColors: PfsLinkLocalColor[];
  /** Variantes PFS trouvées pour cette référence. */
  candidates: PfsLinkCandidate[];
  /** Liens déjà sauvés en BDD : { ProductColor.id → pfsVariantId }. */
  existingLinks: Record<string, string>;
  /** True si Product.pfsProductId est déjà renseigné. */
  alreadyLinked: boolean;
}

function normalizeColorName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function firstImageOf(images: Record<string, string | string[]> | undefined): string | null {
  if (!images) return null;
  for (const v of Object.values(images)) {
    if (Array.isArray(v)) {
      if (v.length > 0 && typeof v[0] === "string" && v[0].trim()) return v[0];
    } else if (typeof v === "string" && v.trim()) {
      return v;
    }
  }
  return null;
}

function buildSizeLabel(variant: PfsVariantDetail): string {
  if (variant.type === "PACK") {
    const total = variant.packs?.reduce(
      (sum, p) => sum + p.sizes.reduce((s, sz) => s + (sz.qty ?? 0), 0),
      0,
    );
    return total && total > 0 ? `PACK ×${total}` : "PACK";
  }
  return variant.item?.size ?? "TU";
}

function buildLabelFr(labels: Record<string, string> | undefined | null): string {
  if (!labels) return "";
  return labels.fr || labels.en || Object.values(labels)[0] || "";
}

/**
 * Récupère le produit PFS via checkReference + variants, et propose un mapping
 * couleur BJ ↔ variante PFS pré-rempli (par couleurs déjà liées, sinon par nom).
 */
export async function previewPfsMatchByReference(
  productId: string,
  referenceInput?: string,
): Promise<
  | { success: true; data: PfsLinkPreview }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        name: true,
        pfsProductId: true,
        pfsBrandId: true,
        pfsBrandName: true,
        colors: {
          select: {
            id: true,
            saleType: true,
            unitPrice: true,
            stock: true,
            weight: true,
            packQuantity: true,
            pfsVariantId: true,
            color: {
              select: {
                id: true,
                name: true,
                hex: true,
                patternImage: true,
                pfsColorRef: true,
              },
            },
            variantSizes: {
              select: { size: { select: { name: true } } },
            },
            images: {
              select: { path: true },
              orderBy: { order: "asc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!product) return { success: false, error: "Produit introuvable." };

    const pfsReference = (referenceInput?.trim() ||
      product.reference).trim();
    if (!pfsReference) return { success: false, error: "Référence vide." };

    // 1. Lookup produit PFS par référence exacte
    let checkRes;
    try {
      checkRes = await pfsCheckReference(pfsReference);
    } catch (err) {
      logger.warn("[PFS Link] checkReference failed", { error: err, pfsReference });
      return {
        success: false,
        error:
          err instanceof Error && err.message.includes("404")
            ? `Aucun produit PFS trouvé avec la référence « ${pfsReference} ».`
            : err instanceof Error
              ? err.message
              : "Erreur PFS",
      };
    }
    if (!checkRes.exists || !checkRes.product) {
      return {
        success: false,
        error: `Aucun produit PFS trouvé avec la référence « ${pfsReference} ».`,
      };
    }
    const pfsProd = checkRes.product;

    // 2. Récupère toutes les variantes PFS du produit
    let variantsRes;
    try {
      variantsRes = await pfsGetVariants(pfsProd.id);
    } catch (err) {
      logger.warn("[PFS Link] getVariants failed", { error: err, pfsProductId: pfsProd.id });
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erreur PFS (variants)",
      };
    }
    const pfsVariants = variantsRes.data ?? [];

    // 3. Local colors BJ (toutes, UNIT et PACK — PFS gère les deux).
    //    Fallback image en 2 niveaux :
    //     (a) image portée directement par la ProductColor (via `pc.images`) ;
    //     (b) image portée au niveau (productId, colorId) mais non attachée à
    //         cette ProductColor précise — cas fréquent après propagation de
    //         couleur, où `ProductColorImage.productColorId` reste `null`.
    //     (c) dernier recours : n'importe quelle image du produit.
    //    Sans ces fallbacks, la case « Notre Boutique » de la modale affiche
    //    « Pas d'image » sur les produits type E841C alors qu'une image existe.
    const allProductImages = await prisma.productColorImage.findMany({
      where: { productId: product.id },
      orderBy: { order: "asc" },
      select: { colorId: true, path: true },
    });
    const imageByColorId = new Map<string, string>();
    for (const img of allProductImages) {
      if (!imageByColorId.has(img.colorId)) imageByColorId.set(img.colorId, img.path);
    }
    const anyProductImage = allProductImages[0]?.path ?? null;
    const localColors: PfsLinkLocalColor[] = product.colors
      .filter((pc) => pc.color)
      .map((pc) => ({
        productColorId: pc.id,
        colorId: pc.color!.id,
        name: pc.color!.name,
        hex: pc.color!.hex,
        patternImage: pc.color!.patternImage,
        saleType: pc.saleType,
        productImage:
          pc.images[0]?.path ??
          imageByColorId.get(pc.color!.id) ??
          anyProductImage,
        unitPrice: Number(pc.unitPrice),
        packQuantity: pc.packQuantity ?? null,
        sizes: pc.variantSizes.map((vs) => vs.size?.name).filter(Boolean) as string[],
        stock: pc.stock ?? 0,
        weightKg: Number(pc.weight ?? 0),
        existingPfsColorRef: pc.color!.pfsColorRef,
      }));

    // 4. Candidates PFS — une entrée par variante PFS, avec suggestion auto
    //    par nom normalisé (en priorisant le même saleType que la variante PFS).
    const candidates: PfsLinkCandidate[] = pfsVariants.map((v) => {
      const colorInfo = v.type === "ITEM"
        ? v.item?.color
        : v.packs?.[0]?.color;
      const colorId = colorInfo?.id ?? 0;
      const colorRef = colorInfo?.reference ?? "";
      const colorHex = colorInfo?.value ?? "#9CA3AF";
      const colorImage = colorInfo?.image ?? null;
      const colorName = buildLabelFr(colorInfo?.labels) || colorRef;

      // Suggestion : on cherche une ProductColor BJ avec
      //  - le même saleType (UNIT/PACK)
      //  - même nom de couleur normalisé
      //  - pas déjà mappée à une autre variante (on traite dans l'ordre)
      const normColor = normalizeColorName(colorName);
      const wantedSaleType = v.type === "PACK" ? "PACK" : "UNIT";
      const suggested = localColors.find(
        (lc) =>
          lc.saleType === wantedSaleType &&
          normalizeColorName(lc.name) === normColor,
      );

      const variantImages = v.images as Record<string, string | string[]> | undefined;
      return {
        pfsVariantId: v.id,
        type: v.type,
        pfsColorId: colorId,
        pfsColorRef: colorRef,
        pfsColorName: colorName,
        pfsColorHex: colorHex,
        pfsColorImage: colorImage,
        sizeLabel: buildSizeLabel(v),
        packSizes:
          v.type === "PACK"
            ? Array.from(
                new Set(
                  (v.packs ?? []).flatMap((p) =>
                    (p.sizes ?? [])
                      .filter((sz) => (sz.qty ?? 0) > 0)
                      .map((sz) => sz.size),
                  ),
                ),
              )
            : [],
        priceUnit: v.price_sale?.unit?.value ?? 0,
        priceTotal: v.price_sale?.total?.value ?? v.price_sale?.unit?.value ?? 0,
        packQuantity: v.type === "PACK" ? (v.pieces ?? null) : null,
        stockQty: v.stock_qty ?? 0,
        weightKg: v.weight ?? 0,
        isActive: !!v.is_active,
        imageUrl: firstImageOf(variantImages),
        suggestedLocalColorId: suggested?.productColorId ?? null,
      };
    });

    // 5. Liens déjà en BDD pour pré-remplir la modale à la réouverture
    const existingLinks: Record<string, string> = {};
    for (const pc of product.colors) {
      if (pc.pfsVariantId) existingLinks[pc.id] = pc.pfsVariantId;
    }

    return {
      success: true,
      data: {
        productId: product.id,
        productName: product.name,
        reference: product.reference,
        pfsReference,
        pfsProductId: pfsProd.id,
        pfsProductName: buildLabelFr(pfsProd.label),
        pfsBrandId: pfsProd.brand?.id ?? product.pfsBrandId,
        pfsBrandName: pfsProd.brand?.name ?? product.pfsBrandName,
        pfsProductImage: firstImageOf(
          pfsProd.images as Record<string, string | string[]>,
        ),
        localColors,
        candidates,
        existingLinks,
        alreadyLinked: !!product.pfsProductId,
      },
    };
  } catch (err) {
    logger.warn("[PFS Link] previewPfsMatchByReference failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Écrit les correspondances en BDD : Product.pfsProductId + brand + chaque
 * ProductColor.pfsVariantId. Reset du snapshot pour forcer un full resync au
 * prochain push. Lance ensuite une sync best-effort pour aligner stock/prix.
 */
export async function linkPfsProductManually(
  productId: string,
  pfsProductId: string,
  brand: { id: string | null; name: string | null } | null,
  links: Array<{ productColorId: string; pfsVariantId: string; pfsColorRef?: string }>,
  intents?: {
    /** productColorId des couleurs BJ à créer côté PFS (informatif — pfsUpdateProductInPlace forceFullSync les crée déjà). */
    colorsToCreate: string[];
    /** pfsVariantId des variantes PFS orphelines à supprimer avant la sync. */
    orphansToDelete: string[];
    /** pfsVariantId des variantes PFS orphelines à importer en tant que ProductColor BJ + lier. */
    orphansToImport: string[];
  },
): Promise<{
  success: boolean;
  error?: string;
  linked?: number;
  /** Nombre de couleurs BJ orphelines créées côté PFS par la sync post-liaison. */
  autoCreatedOnMarketplace?: number;
  /** Variantes PFS orphelines supprimées avant la sync. */
  deletedOnMarketplace?: number;
  /** Variantes PFS orphelines importées en tant que ProductColor BJ liée. */
  importedFromMarketplace?: number;
  /** Warning non bloquant : la liaison est posée mais la sync post-liaison a
   *  échoué. L'admin peut relancer « Resync » depuis la fiche. */
  syncWarning?: string;
}> {
  try {
    await requireAdmin();

    if (!pfsProductId.trim()) {
      return { success: false, error: "ID PFS du produit vide." };
    }
    if (links.length === 0 && (!intents || intents.colorsToCreate.length === 0)) {
      return { success: false, error: "Aucune couleur sélectionnée." };
    }

    // Validation : pas de doublon de pfsVariantId (1 variante PFS = 1 ProductColor BJ max)
    const seenPfsVid = new Set<string>();
    for (const l of links) {
      if (seenPfsVid.has(l.pfsVariantId)) {
        return {
          success: false,
          error: `La variante PFS ${l.pfsVariantId} apparaît plusieurs fois dans le mapping.`,
        };
      }
      seenPfsVid.add(l.pfsVariantId);
    }

    // Validation : 1 ProductColor BJ = 1 variante PFS max
    const seenLocal = new Set<string>();
    for (const l of links) {
      if (seenLocal.has(l.productColorId)) {
        return {
          success: false,
          error: "Une variante locale est liée à plusieurs variantes PFS.",
        };
      }
      seenLocal.add(l.productColorId);
    }

    // Vérifie que les ProductColor appartiennent bien à ce produit
    const productColors = await prisma.productColor.findMany({
      where: { productId, id: { in: links.map((l) => l.productColorId) } },
      select: { id: true, colorId: true },
    });
    if (productColors.length !== links.length) {
      return {
        success: false,
        error: "Certaines variantes sélectionnées n'appartiennent pas à ce produit.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          pfsProductId: pfsProductId.trim(),
          pfsBrandId: brand?.id ?? null,
          pfsBrandName: brand?.name ?? null,
          pfsLastSyncSnapshot: Prisma.DbNull,
          pfsSyncRequired: false,
        },
      });

      // Reset propre : on efface d'abord tous les pfsVariantId de ce produit
      await tx.productColor.updateMany({
        where: { productId },
        data: { pfsVariantId: null },
      });

      for (const l of links) {
        await tx.productColor.update({
          where: { id: l.productColorId },
          data: { pfsVariantId: l.pfsVariantId.trim() },
        });

        // Si la Color BJ n'a pas encore de pfsColorRef et qu'on en a un, on
        // l'enregistre pour les prochaines sync. Sinon on laisse le mapping
        // existant intact.
        if (l.pfsColorRef && l.pfsColorRef.trim()) {
          const pcInfo = productColors.find((p) => p.id === l.productColorId);
          if (pcInfo?.colorId) {
            await tx.color.updateMany({
              where: { id: pcInfo.colorId, pfsColorRef: null },
              data: { pfsColorRef: l.pfsColorRef.trim() },
            });
          }
        }
      }
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    logger.info("[PFS Link] Manual link saved", {
      productId,
      pfsProductId,
      linkedColors: links.length,
    });

    // Suppression des variantes PFS orphelines marquées par l'admin. Fait avant
    // la sync pour éviter que forceFullSync ne les recrée par snapshot delta.
    let deletedOnMarketplace = 0;
    if (intents && intents.orphansToDelete.length > 0) {
      const { pfsDeleteVariant } = await import("@/lib/pfs-api-write");
      for (const pfsVariantId of intents.orphansToDelete) {
        try {
          await pfsDeleteVariant(pfsVariantId);
          deletedOnMarketplace += 1;
        } catch (err) {
          logger.warn("[PFS Link] Suppression orpheline en erreur", {
            pfsVariantId,
            error: err,
          });
        }
      }
    }

    // Import des orphelines PFS marquées « Créer chez nous ». Fait APRÈS le
    // link (qui a posé pfsProductId) et AVANT la sync post-liaison, pour que
    // la sync trouve les ProductColor déjà en place.
    let importedFromMarketplace = 0;
    if (intents && intents.orphansToImport.length > 0) {
      for (const pfsVariantId of intents.orphansToImport) {
        try {
          const imp = await createLocalVariantFromPfsVariant(productId, pfsVariantId);
          if (imp.success) {
            importedFromMarketplace += 1;
          } else {
            logger.warn("[PFS Link] Import orpheline échoué", {
              pfsVariantId,
              error: imp.error,
            });
          }
        } catch (err) {
          logger.warn("[PFS Link] Import orpheline en erreur", { pfsVariantId, error: err });
        }
      }
    }

    // Sync best-effort post-liaison : on pousse stock/prix/visibilité pour
    // aligner les 2 côtés sans étape manuelle. Si la sync échoue, on garde la
    // liaison et on remonte un warning. Cette sync s'occupe aussi de créer
    // côté PFS les couleurs BJ non-mappées (voir lib/pfs-update.ts §variantsToCreate).
    let syncWarning: string | undefined;
    let autoCreatedOnMarketplace = 0;
    try {
      const { pfsUpdateProductInPlace } = await import("@/lib/pfs-update");
      const res = await pfsUpdateProductInPlace(productId, undefined, {
        forceFullSync: true,
      });
      if (!res.success) syncWarning = res.error;
      // pfsUpdateProductInPlace n'expose pas encore de compteur explicite — on
      // dérive à partir du nombre de couleurs à créer que l'admin avait
      // marquées (le sync les couvre toutes en forceFullSync).
      autoCreatedOnMarketplace = intents?.colorsToCreate.length ?? 0;
    } catch (err) {
      syncWarning = err instanceof Error ? err.message : String(err);
      logger.warn("[PFS Link] Post-link sync failed", { productId, error: err });
    }

    return {
      success: true,
      linked: links.length,
      autoCreatedOnMarketplace,
      deletedOnMarketplace,
      importedFromMarketplace,
      syncWarning,
    };
  } catch (err) {
    logger.warn("[PFS Link] linkPfsProductManually failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Délie un produit de PFS (côté BDD seulement — la fiche PFS reste inchangée).
 */
export async function removePfsMatch(
  productId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          pfsProductId: null,
          pfsBrandId: null,
          pfsBrandName: null,
          pfsLastSyncSnapshot: Prisma.DbNull,
          pfsSyncRequired: false,
        },
      });
      await tx.productColor.updateMany({
        where: { productId },
        data: { pfsVariantId: null },
      });
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    logger.info("[PFS Link] Match removed", { productId });
    return { success: true };
  } catch (err) {
    logger.warn("[PFS Link] removePfsMatch failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Crée une ProductColor UNIT locale à partir d'une variante PFS existante,
 * et la lie automatiquement (pfsVariantId déjà posé). Utilisé depuis la
 * modale de liaison quand PFS a une variante en plus : « Créer chez nous »
 * → la couleur arrive directement liée.
 *
 * Prérequis : `product.pfsProductId` doit être posé (via linkPfsProductManually).
 * Ne supporte pour l'instant que les variantes ITEM (UNIT). Pour PACK, l'admin
 * doit créer la variante manuellement dans l'admin.
 */
export async function createLocalVariantFromPfsVariant(
  productId: string,
  pfsVariantId: string,
): Promise<{
  success: boolean;
  error?: string;
  productColorId?: string;
  createdColor?: boolean;
}> {
  try {
    await requireAdmin();

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        pfsProductId: true,
        colors: {
          where: { saleType: "UNIT" },
          select: { weight: true },
        },
      },
    });
    if (!product) return { success: false, error: "Produit introuvable." };
    if (!product.pfsProductId) {
      return {
        success: false,
        error: "Produit non lié à PFS — finissez d'abord la liaison de base.",
      };
    }

    const { generateSku } = await import("@/lib/sku");
    const variantsResp = await pfsGetVariants(product.pfsProductId);
    const pfsVariant = variantsResp.data.find((v) => v.id === pfsVariantId);
    if (!pfsVariant) {
      return {
        success: false,
        error: `La variante PFS ${pfsVariantId} n'est plus visible.`,
      };
    }
    if (pfsVariant.type !== "ITEM") {
      return {
        success: false,
        error:
          "Cette variante PFS est un PACK — les imports automatiques ne gèrent que les variantes UNIT. Crée le pack manuellement dans l'admin puis relie.",
      };
    }
    const pfsColor = pfsVariant.item?.color;
    if (!pfsColor) {
      return { success: false, error: "Variante PFS sans info couleur." };
    }

    // Trouve ou crée la Color BJ : match par pfsColorRef si présent, sinon par nom.
    const colorName = pfsColor.labels?.fr ?? pfsColor.reference ?? "Couleur";
    let bjColor = await prisma.color.findFirst({
      where: { pfsColorRef: pfsColor.reference },
      select: { id: true, name: true },
    });
    let createdColor = false;
    if (!bjColor) {
      const normalized = colorName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const allColors = await prisma.color.findMany({
        select: { id: true, name: true, pfsColorRef: true },
      });
      const byName = allColors.find(
        (c) =>
          c.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim() === normalized,
      );
      if (byName) {
        bjColor = { id: byName.id, name: byName.name };
        if (!byName.pfsColorRef && pfsColor.reference) {
          await prisma.color.update({
            where: { id: byName.id },
            data: { pfsColorRef: pfsColor.reference },
          });
        }
      } else {
        const created = await prisma.color.create({
          data: {
            name: colorName,
            hex: "#CCCCCC",
            pfsColorRef: pfsColor.reference,
          },
          select: { id: true, name: true },
        });
        bjColor = created;
        createdColor = true;
        logger.info("[PFS Link] Color BJ créée à la volée depuis variante PFS", {
          colorId: bjColor.id,
          name: bjColor.name,
          pfsColorRef: pfsColor.reference,
        });
      }
    }

    // Size par défaut : TU si existe, sinon la 1ʳᵉ.
    let size = await prisma.size.findFirst({
      where: { name: { in: ["TU", "Taille unique"] } },
      select: { id: true },
    });
    if (!size) {
      size = await prisma.size.findFirst({
        orderBy: { position: "asc" },
        select: { id: true },
      });
    }
    if (!size) {
      return {
        success: false,
        error: "Aucune taille définie dans la bibliothèque BJ — crée d'abord une taille.",
      };
    }

    // Anti-doublon : si le produit a déjà une ProductColor UNIT sur cette Color,
    // on RELIE l'existante au lieu d'en créer une nouvelle. Erreur si l'existante
    // est déjà liée à une AUTRE variante PFS.
    const existingPc = await prisma.productColor.findFirst({
      where: { productId, colorId: bjColor.id, saleType: "UNIT" },
      select: { id: true, pfsVariantId: true },
    });
    if (existingPc) {
      if (existingPc.pfsVariantId && existingPc.pfsVariantId !== pfsVariant.id) {
        return {
          success: false,
          error: `La couleur ${bjColor.name} est déjà liée à une autre variante PFS (${existingPc.pfsVariantId}). Délie-la d'abord si tu veux la relier à ${pfsVariant.id}.`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await tx.productColor.update({
          where: { id: existingPc.id },
          data: { pfsVariantId: pfsVariant.id },
        });
        await tx.product.update({
          where: { id: productId },
          data: { pfsLastSyncSnapshot: Prisma.DbNull },
        });
      });
      revalidatePath(`/admin/produits/${productId}/modifier`);
      revalidatePath(`/admin/produits`);
      revalidateTag("products", "default");
      logger.info("[PFS Link] ProductColor existante reliée à la variante PFS", {
        productId,
        productColorId: existingPc.id,
        pfsVariantId: pfsVariant.id,
      });
      return { success: true, productColorId: existingPc.id, createdColor: false };
    }

    const pfsPrice = pfsVariant.price_sale?.unit?.value ?? 0;
    const weight =
      product.colors.length > 0
        ? product.colors.reduce((sum, c) => sum + (c.weight || 0), 0) / product.colors.length
        : (pfsVariant.weight || 0.01);

    const totalVariants = await prisma.productColor.count({ where: { productId } });
    const sku = generateSku(product.reference, [bjColor.name], "UNIT", totalVariants + 1);

    const newPc = await prisma.$transaction(async (tx) => {
      const pc = await tx.productColor.create({
        data: {
          productId,
          colorId: bjColor!.id,
          saleType: "UNIT",
          unitPrice: pfsPrice,
          stock: 0,
          weight: Number.isFinite(weight) && weight > 0 ? weight : 0.01,
          isPrimary: false,
          disabled: false,
          sku,
          pfsVariantId: pfsVariant.id,
          variantSizes: {
            create: [{ sizeId: size!.id, quantity: 1 }],
          },
        },
        select: { id: true },
      });
      await tx.product.update({
        where: { id: productId },
        data: { pfsLastSyncSnapshot: Prisma.DbNull },
      });
      return pc;
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    logger.info("[PFS Link] ProductColor créée depuis variante PFS", {
      productId,
      productColorId: newPc.id,
      pfsVariantId,
      createdColor,
    });

    return { success: true, productColorId: newPc.id, createdColor };
  } catch (err) {
    logger.warn("[PFS Link] createLocalVariantFromPfsVariant failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

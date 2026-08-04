"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  ankorstoreGetProduct,
  type AnkorstoreProduct,
} from "@/lib/ankorstore-api";
import {
  runAutoMatch,
  type BjProductForMatch,
  type VariantMatchPair,
} from "@/lib/ankorstore-match";
import { autoLinkAnkorstoreVariants } from "@/lib/ankorstore-variant-link";
import { ankorstoreKickoffUpdate } from "@/lib/ankorstore-update";
import { requireCurrentTenant } from "@/lib/tenant";

/**
 * Loggue un warning si l'external_id AS est vide ou différent de la ref BJ,
 * pour tracer les cas de liaison "à risque". La protection anti-doublon
 * effective se joue au moment de la synchro (Fix 2 dans lib/ankorstore-update.ts) :
 *   - Mode "update" (variantes toutes déjà liées) : AS skip silencieusement
 *     si external_id ne matche pas → aucun doublon possible.
 *   - Mode "import" (nouvelles variantes à créer) : bloqué explicitement par
 *     Fix 2 avec message clair. C'est là que le risque JG6 est neutralisé.
 *
 * On laisse donc la liaison passer : beaucoup d'anciens produits Ankorstore
 * (importés Excel ou créés à la main sur le back-office AS) n'ont pas
 * d'external_id posé. La cliente doit pouvoir les lier — les PATCH stock/prix
 * fonctionnent nativement (endpoints directs sur variantId), et la garde
 * import bloquera proprement le cas dangereux.
 */
function logAnkorstoreExternalIdMismatch(
  ankorstoreProduct: AnkorstoreProduct,
  bjReference: string,
  context: string,
): void {
  const asExt = (ankorstoreProduct.externalId ?? "").trim();
  const bjRef = bjReference.trim();
  if (!asExt) {
    logger.warn("[Ankorstore Link] Liaison sur produit AS sans external_id (à risque en cas d'ajout de variante)", {
      context,
      ankorstoreProductId: ankorstoreProduct.id,
      bjReference: bjRef,
    });
  } else if (asExt.toUpperCase() !== bjRef.toUpperCase()) {
    logger.warn("[Ankorstore Link] Liaison sur produit AS avec external_id différent de la ref BJ", {
      context,
      ankorstoreProductId: ankorstoreProduct.id,
      asExternalId: asExt,
      bjReference: bjRef,
    });
  }
}

/**
 * Après une liaison fraîche (mass match, manual link, manual variant link),
 * pousse l'intégralité des données locales vers Ankorstore : rename SKU,
 * taille, stock, prix gros + détail (via majoration Ankorstore). Best-effort :
 * un échec côté Ankorstore ne casse pas la pose du lien (qui est déjà
 * committée). L'utilisatrice pourra relancer un "Rafraîchir" plus tard.
 */
async function kickoffOverwriteFromLink(productId: string): Promise<void> {
  try {
    const res = await ankorstoreKickoffUpdate(productId, { forceFullSync: true });
    if (!res.success) {
      logger.warn("[Ankorstore Link] Overwrite kickoff failed (link kept)", {
        productId,
        error: res.error,
      });
    } else {
      logger.info("[Ankorstore Link] Overwrite kicked off after link", {
        productId,
        operationId: res.operationId,
      });
    }
  } catch (err) {
    logger.warn("[Ankorstore Link] Overwrite kickoff threw (link kept)", {
      productId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

/**
 * Lie un produit local à un produit Ankorstore existant. Remplit
 * `Product.ankorsProductId` et `ProductColor.ankorsVariantId` à partir
 * du mapping de variantes fourni.
 *
 * Le `ankorsLastSyncSnapshot` reste null : la prochaine publication
 * incrémentale fera donc une sync complète (comportement natif de
 * `ankorstoreUpdateProductInPlace` quand le snapshot est vide).
 */
export async function confirmAnkorstoreMatch(
  productId: string,
  ankorstoreProductId: string,
  variantMatches: { localColorId: string; ankorstoreVariantId: string }[],
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          ankorsProductId: ankorstoreProductId,
          ankorsLastSyncSnapshot: Prisma.DbNull,
        },
      });

      // Re-liaison : on efface d'abord tous les anciens ankorsVariantId de ce
      // produit pour éviter de garder des références orphelines vers
      // l'ancienne liaison Ankorstore.
      await tx.productColor.updateMany({
        where: { productId },
        data: { ankorsVariantId: null },
      });

      // Ankorstore ne supporte pas les packs : on ne pose l'ankorsVariantId que
      // sur les variantes UNIT.
      for (const m of variantMatches) {
        await tx.productColor.updateMany({
          where: { productId, colorId: m.localColorId, saleType: "UNIT" },
          data: { ankorsVariantId: m.ankorstoreVariantId },
        });
      }
    });

    // Filet de sécurité : complète l'appariement des variantes encore non liées
    // (cas où le mapping fourni était partiel, ou où la structure SKU diffère).
    try {
      await autoLinkAnkorstoreVariants(productId);
    } catch (err) {
      logger.warn("[Ankorstore] confirmAnkorstoreMatch — autoLink variants failed", {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Écrasement Ankorstore : pousse nos SKU/taille/stock/prix vers AS.
    // Best-effort en background — la liaison reste posée si ça échoue.
    await kickoffOverwriteFromLink(productId);

    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidateTag("products", "default");

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] confirmAnkorstoreMatch failed", { productId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Efface le lien Ankorstore d'un produit (sans toucher à Ankorstore).
 */
export async function removeAnkorstoreMatch(
  productId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          ankorsProductId: null,
          ankorsLastSyncSnapshot: Prisma.DbNull,
        },
      });
      await tx.productColor.updateMany({
        where: { productId },
        data: { ankorsVariantId: null },
      });
    });

    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidateTag("products", "default");

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] removeAnkorstoreMatch failed", { productId, error: message });
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// Aperçu pour la modale de liaison (étape 2)
// ─────────────────────────────────────────────

export interface AnkorstoreLinkPreviewLocalColor {
  productImage: string | null;
  weightKg: number;
  /** Prix unitaire boutique (€, HT) — c'est la valeur qui sera envoyée à Ankorstore à la sync. */
  unitPrice: number;
  /** Stock boutique — envoyé à Ankorstore à la sync. */
  stock: number;
  existingAnkorstoreVariantId: string | null;
  /** Id de la ProductColor (jointure produit/couleur). */
  productColorId: string;
  /** Id de la Color (bibliothèque). */
  colorId: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  /** SKU + taille pour info à l'admin (peut aider à comprendre la nature de la variante). */
  sku: string | null;
  sizeName: string | null;
  /** True si une autre variante locale est déjà liée à une variante Ankorstore (autre produit). */
  isAlreadyLinked: boolean;
}

export interface AnkorstoreLinkPreviewVariant {
  weightKg: number;
  ankorstoreVariantId: string;
  sku: string | null;
  /** Option couleur côté Ankorstore (renseignée dans variant.options). */
  colorOption: string | null;
  /** Option taille côté Ankorstore. */
  sizeOption: string | null;
  /** Première image associée à la variante (fallback : image principale du produit). */
  imageUrl: string | null;
  wholesalePrice: number;
  retailPrice: number;
  stockQuantity: number;
  /** Mapping auto pré-calculé — null si le matching n'a pas pu décider. */
  suggestedLocalColorId: string | null;
}

export interface AnkorstoreLinkPreview {
  ankorstoreProduct: {
    id: string;
    name: string;
    description: string;
    mainImage: string | null;
    extraImages: string[];
  };
  variants: AnkorstoreLinkPreviewVariant[];
  localColors: AnkorstoreLinkPreviewLocalColor[];
}

/**
 * Prépare les données nécessaires à l'étape 2 de la modale de liaison :
 * - infos du produit Ankorstore (nom, images, description, variantes)
 * - couleurs locales du produit (avec leur visuel)
 * - mapping suggéré couleur Ankorstore → couleur locale (pré-rempli)
 *
 * Ne pose AUCUN lien : c'est juste un GET pour aider l'admin à valider.
 */
export async function previewAnkorstoreProductForLinking(
  productId: string,
  ankorstoreProductId: string,
): Promise<{ success: true; data: AnkorstoreLinkPreview } | { success: false; error: string }> {
  await requireAdmin();

  try {
    const [akProduct, bjProductRaw] = await Promise.all([
      ankorstoreGetProduct(ankorstoreProductId),
      prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          name: true,
          reference: true,
          colors: {
            where: { saleType: "UNIT" },
            select: {
              id: true,
              colorId: true,
              sku: true,
              weight: true,
              unitPrice: true,
              stock: true,
              ankorsVariantId: true,
              color: { select: { name: true, hex: true, patternImage: true } },
              variantSizes: { select: { size: { select: { name: true } } }, take: 1 },
              images: { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
            },
          },
        },
      }),
    ]);

    if (!akProduct) {
      return { success: false, error: "Produit Ankorstore introuvable." };
    }
    if (!bjProductRaw) {
      return { success: false, error: "Produit local introuvable." };
    }

    const bjForMatch: BjProductForMatch = {
      id: bjProductRaw.id,
      name: bjProductRaw.name,
      reference: bjProductRaw.reference,
      colors: bjProductRaw.colors
        .filter((pc) => pc.colorId && pc.color)
        .map((pc) => ({ id: pc.colorId as string, name: pc.color!.name })),
    };

    // Aligner artificiellement le nom (comme dans linkAnkorstoreProductManually)
    // pour que runAutoMatch considère ce produit comme candidat à ce produit local.
    const fakeRefAlignedProduct: AnkorstoreProduct = {
      ...akProduct,
      name: `${akProduct.name} - ${bjProductRaw.reference}`,
    };
    const report = runAutoMatch([fakeRefAlignedProduct], [bjForMatch]);
    const result = report.results[0];

    // runAutoMatch renvoie un `bjColorId` = Color.id (bibliothèque). Mais la
    // modale de liaison indexe le mapping par ProductColor.id — elle affiche
    // les suggestions et détecte les "déjà utilisées ailleurs" via cette clé.
    // Si on laissait bjColorId tel quel, la colonne Ankorstore resterait vide
    // et toutes les variantes apparaîtraient "À déplacer" dans le déroulant
    // (mapping[productColorId] introuvable, mais Object.values(mapping) matche
    // quand même les cand.id). On traduit donc colorId → productColorId ici.
    const productColorIdByColorId = new Map<string, string>();
    for (const pc of bjProductRaw.colors) {
      if (pc.colorId && !productColorIdByColorId.has(pc.colorId)) {
        productColorIdByColorId.set(pc.colorId, pc.id);
      }
    }
    const suggestedByAkVariantId = new Map<string, string | null>();
    for (const vm of result.variantMatches ?? []) {
      const suggestedProductColorId = vm.bjColorId
        ? productColorIdByColorId.get(vm.bjColorId) ?? null
        : null;
      suggestedByAkVariantId.set(vm.ankorstoreVariant.id, suggestedProductColorId);
    }

    const extraImages = akProduct.images
      .slice(0, 8)
      .map((i) => i.url)
      .filter((u): u is string => !!u);
    // Image principale = première du produit, ou première variante avec image
    const mainImage =
      akProduct.images[0]?.url ??
      akProduct.variants.find((v) => v.images?.[0]?.url)?.images?.[0]?.url ??
      null;

    // Ankorstore stocke le poids au niveau produit (shape_properties.weight.amount en kg).
    // Toutes les variantes d'un même produit partagent donc le même poids.
    const productWeightKg = akProduct.shape_properties?.weight?.amount ?? 0;
    const variants: AnkorstoreLinkPreviewVariant[] = akProduct.variants.map((v) => {
      const colorOption =
        v.options?.find((o) => o.name === "color")?.value ?? null;
      const sizeOption =
        v.options?.find((o) => o.name === "size")?.value ?? null;
      const variantImage = v.images?.[0]?.url ?? null;
      return {
        ankorstoreVariantId: v.id,
        sku: v.sku ?? null,
        colorOption,
        sizeOption,
        imageUrl: variantImage ?? mainImage,
        wholesalePrice: Number(v.wholesalePrice ?? 0),
        retailPrice: Number(v.retailPrice ?? 0),
        stockQuantity: v.stockQuantity ?? 0,
        weightKg: productWeightKg,
        suggestedLocalColorId: suggestedByAkVariantId.get(v.id) ?? null,
      };
    });

    // Fallback image en 2 niveaux (couvre le cas où ProductColorImage.productColorId
    // est null — images propagées au niveau (productId, colorId) sans être liées à
    // une ProductColor précise).
    const allProductImages = await prisma.productColorImage.findMany({
      where: { productId: bjProductRaw.id },
      orderBy: { order: "asc" },
      select: { colorId: true, path: true },
    });
    const imageByColorId = new Map<string, string>();
    for (const img of allProductImages) {
      if (!imageByColorId.has(img.colorId)) imageByColorId.set(img.colorId, img.path);
    }
    const fallbackImage = allProductImages[0]?.path ?? null;
    const localColors: AnkorstoreLinkPreviewLocalColor[] = bjProductRaw.colors
      .filter((pc) => pc.colorId && pc.color)
      .map((pc) => ({
        productColorId: pc.id,
        colorId: pc.colorId as string,
        name: pc.color!.name,
        hex: pc.color!.hex ?? null,
        patternImage: pc.color!.patternImage ?? null,
        sku: pc.sku ?? null,
        sizeName: pc.variantSizes[0]?.size.name ?? null,
        productImage:
          pc.images[0]?.path ??
          imageByColorId.get(pc.colorId as string) ??
          fallbackImage,
        weightKg: Number(pc.weight ?? 0),
        unitPrice: Number(pc.unitPrice ?? 0),
        stock: pc.stock ?? 0,
        // Une couleur BJ est « déjà liée » côté Ankor uniquement si sa variante
        // Ankor courante existe dans la liste des variantes du produit qu'on regarde.
        // Sinon c'est une liaison résiduelle vers un ancien produit Ankor — on ignore.
        existingAnkorstoreVariantId:
          pc.ankorsVariantId &&
          akProduct.variants.some((v) => v.id === pc.ankorsVariantId)
            ? pc.ankorsVariantId
            : null,
        isAlreadyLinked:
          pc.ankorsVariantId !== null &&
          akProduct.variants.some((v) => v.id === pc.ankorsVariantId),
      }));

    return {
      success: true,
      data: {
        ankorstoreProduct: {
          id: akProduct.id,
          name: akProduct.name,
          description: akProduct.description ?? "",
          mainImage,
          extraImages,
        },
        variants,
        localColors,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] previewAnkorstoreProductForLinking failed", {
      productId,
      ankorstoreProductId,
      error: message,
    });
    return { success: false, error: message };
  }
}

/**
 * Liaison via mapping explicite (toutes les variantes Ankorstore doivent
 * être mappées à une couleur locale). C'est la voie utilisée par la nouvelle
 * modale en 2 étapes : l'admin choisit le produit Ankorstore (étape 1) puis
 * valide / corrige le mapping (étape 2).
 *
 * `linkAnkorstoreProductManually` plus bas reste exposée pour la
 * rétro-compatibilité (matching auto sans étape 2).
 */
export async function linkAnkorstoreProductWithMapping(
  productId: string,
  ankorstoreProductId: string,
  mapping: { ankorstoreVariantId: string; localColorId: string }[],
  intents?: {
    /** productColorId des couleurs BJ à créer côté Ankorstore. La sync post-liaison callback les crée. */
    colorsToCreate: string[];
    /** ankorstoreVariantId des variantes à supprimer. Ankorstore supprime naturellement les orphelines à la sync. */
    orphansToDelete: string[];
    /** ankorstoreVariantId des variantes à importer en tant que ProductColor BJ + lier. */
    orphansToImport: string[];
  },
): Promise<{
  success: boolean;
  error?: string;
  linked?: number;
  autoCreatedOnMarketplace?: number;
  deletedOnMarketplace?: number;
  importedFromMarketplace?: number;
  syncWarning?: string;
}> {
  await requireAdmin();

  if (mapping.length === 0 && (!intents || intents.colorsToCreate.length === 0)) {
    return {
      success: false,
      error: "Aucun mapping fourni — chaque variante Ankorstore doit être liée à une couleur locale.",
    };
  }

  // Garde-fou : pas de doublon côté Ankorstore (une variante AS mappée 2 fois)
  const seenAk = new Set<string>();
  for (const m of mapping) {
    if (seenAk.has(m.ankorstoreVariantId)) {
      return {
        success: false,
        error: "Une variante Ankorstore est mappée plusieurs fois — corrigez le mapping.",
      };
    }
    seenAk.add(m.ankorstoreVariantId);
  }

  // Trace des liaisons à risque (external_id AS vide ou mismatch). La vraie
  // protection anti-doublon se joue côté synchro (Fix 2 dans ankorstore-update.ts) :
  // un mode "import" avec external_id incohérent est refusé avec message clair.
  // On autorise ici la liaison pour ne pas bloquer les produits AS anciens
  // (Excel/manuels) sans external_id.
  const bjRefRow = await prisma.product.findUnique({
    where: { id: productId },
    select: { reference: true },
  });
  if (!bjRefRow) return { success: false, error: "Produit local introuvable." };
  const akForCheck = await ankorstoreGetProduct(ankorstoreProductId);
  if (!akForCheck) return { success: false, error: "Produit Ankorstore introuvable." };
  logAnkorstoreExternalIdMismatch(akForCheck, bjRefRow.reference, "linkAnkorstoreProductWithMapping");

  const res = await confirmAnkorstoreMatch(
    productId,
    ankorstoreProductId,
    mapping.map((m) => ({
      localColorId: m.localColorId,
      ankorstoreVariantId: m.ankorstoreVariantId,
    })),
  );
  if (!res.success) return res;

  // Import des orphelines Ankorstore marquées « Créer chez nous ». Fait APRÈS
  // confirmAnkorstoreMatch (createLocalVariantFromAnkorstoreVariant exige
  // ankorsProductId posé). Best-effort : si une import échoue on log et on continue.
  let importedFromMarketplace = 0;
  if (intents && intents.orphansToImport.length > 0) {
    for (const akVariantId of intents.orphansToImport) {
      try {
        const imp = await createLocalVariantFromAnkorstoreVariant(productId, akVariantId);
        if (imp.success) {
          importedFromMarketplace += 1;
        } else {
          logger.warn("[Ankorstore] Import orpheline échoué", {
            akVariantId,
            error: imp.error,
          });
        }
      } catch (err) {
        logger.warn("[Ankorstore] Import orpheline en erreur", { akVariantId, error: err });
      }
    }
  }

  // Ankorstore = callback-only : la sync post-liaison (`kickoffOverwriteFromLink`
  // dans confirmAnkorstoreMatch) écrase l'état AS avec le nôtre. Toutes les
  // variantes non mappées sont naturellement retirées, toutes les couleurs BJ
  // sans ankorsVariantId sont créées. Les compteurs remontés ici sont donc
  // basés sur les intentions déclarées par l'admin dans la modale.
  return {
    ...res,
    linked: mapping.length,
    autoCreatedOnMarketplace: intents?.colorsToCreate.length ?? 0,
    deletedOnMarketplace: intents?.orphansToDelete.length ?? 0,
    importedFromMarketplace,
  };
}

/**
 * Liaison manuelle : on récupère le produit Ankorstore par son ID, on calcule
 * automatiquement le mapping couleur (via `runAutoMatch` sur ce seul produit)
 * et on appelle `confirmAnkorstoreMatch`.
 */
export async function linkAnkorstoreProductManually(
  productId: string,
  ankorstoreProductId: string,
): Promise<{ success: boolean; error?: string; matched?: number; unmatched?: number }> {
  await requireAdmin();

  try {
    const [akProduct, bjProductRaw] = await Promise.all([
      ankorstoreGetProduct(ankorstoreProductId),
      prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          name: true,
          reference: true,
          colors: {
            select: { colorId: true, color: { select: { name: true } } },
          },
        },
      }),
    ]);

    if (!akProduct) {
      return { success: false, error: "Produit Ankorstore introuvable." };
    }
    if (!bjProductRaw) {
      return { success: false, error: "Produit local introuvable." };
    }

    logAnkorstoreExternalIdMismatch(akProduct, bjProductRaw.reference, "linkAnkorstoreProductManually");

    const bjForMatch: BjProductForMatch = {
      id: bjProductRaw.id,
      name: bjProductRaw.name,
      reference: bjProductRaw.reference,
      colors: bjProductRaw.colors
        .filter((pc) => pc.colorId && pc.color)
        .map((pc) => ({
          id: pc.colorId as string,
          name: pc.color!.name,
        })),
    };

    const fakeRefAlignedProduct: AnkorstoreProduct = {
      ...akProduct,
      name: `${akProduct.name} - ${bjProductRaw.reference}`,
    };

    const report = runAutoMatch([fakeRefAlignedProduct], [bjForMatch]);
    const result = report.results[0];

    const variantMatches = (result.variantMatches ?? [])
      .filter((vm: VariantMatchPair) => vm.bjColorId !== null)
      .map((vm: VariantMatchPair) => ({
        localColorId: vm.bjColorId as string,
        ankorstoreVariantId: vm.ankorstoreVariant.id,
      }));

    const confirmRes = await confirmAnkorstoreMatch(
      productId,
      ankorstoreProductId,
      variantMatches,
    );
    if (!confirmRes.success) {
      return { success: false, error: confirmRes.error };
    }

    return {
      success: true,
      matched: variantMatches.length,
      unmatched: akProduct.variants.length - variantMatches.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] linkAnkorstoreProductManually failed", {
      productId,
      ankorstoreProductId,
      error: message,
    });
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// Variantes orphelines (Brique 1 + 2)
// ─────────────────────────────────────────────

export interface LocalOrphanVariant {
  productColorId: string;
  colorId: string | null;
  colorName: string;
  colorHex: string | null;
  patternImage: string | null;
  sku: string | null;
  stock: number;
  unitPrice: number;
  sizeName: string | null;
}

export interface AnkorstoreOrphanVariant {
  ankorstoreVariantId: string;
  sku: string | null;
  name: string;
  colorOption: string | null;
  sizeOption: string | null;
  wholesalePrice: number;
  retailPrice: number;
  stockQuantity: number | null;
  firstImageUrl: string | null;
}

export interface LinkedVariantPair {
  productColorId: string;
  colorName: string;
  colorHex: string | null;
  patternImage: string | null;
  localSku: string | null;
  localStock: number;
  localSizeName: string | null;
  ankorstoreVariantId: string;
  ankorstoreVariantSku: string | null;
  ankorstoreVariantName: string;
  ankorstoreColorOption: string | null;
  ankorstoreSizeOption: string | null;
  ankorstoreWholesalePrice: number;
  ankorstoreStockQuantity: number | null;
  ankorstoreFirstImageUrl: string | null;
}

export interface OrphanVariantsReport {
  ankorsProductId: string;
  ankorstoreProductName: string | null;
  localOrphans: LocalOrphanVariant[];
  ankorstoreOrphans: AnkorstoreOrphanVariant[];
  linkedPairs: LinkedVariantPair[];
}

/**
 * Retourne pour un produit déjà lié à Ankorstore :
 *  - les variantes UNIT locales sans ankorsVariantId (couleurs orphelines de notre côté)
 *  - les variantes Ankorstore dont l'id n'est pas déjà attribué à une variante locale
 *    (variantes orphelines côté Ankorstore)
 */
export async function getOrphanAnkorstoreVariants(
  productId: string,
): Promise<{ success: true; data: OrphanVariantsReport } | { success: false; error: string }> {
  await requireAdmin();

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        ankorsProductId: true,
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          where: { saleType: "UNIT" },
          select: {
            id: true,
            sku: true,
            stock: true,
            unitPrice: true,
            ankorsVariantId: true,
            colorId: true,
            color: { select: { name: true, hex: true, patternImage: true } },
            variantSizes: {
              select: { size: { select: { name: true } } },
              orderBy: { size: { position: "asc" } },
              take: 1,
            },
          },
        },
      },
    });

    if (!product) return { success: false, error: "Produit introuvable." };
    if (!product.ankorsProductId) {
      return { success: false, error: "Produit non lié à Ankorstore — rien à comparer." };
    }

    // Un seul appel API : `ankorstoreGetProduct` ramène le nom du produit ET
    // toutes ses variantes via `include=productVariants`.
    const ankorsProduct = await (await import("@/lib/ankorstore-api")).ankorstoreGetProduct(
      product.ankorsProductId,
    );
    const ankorstoreProductName = ankorsProduct?.name ?? null;
    const ankorsVariants = ankorsProduct?.variants ?? [];
    const ankorsVariantById = new Map(ankorsVariants.map((v) => [v.id, v]));

    const usedAnkorsVariantIds = new Set(
      product.colors.map((c) => c.ankorsVariantId).filter((id): id is string => !!id),
    );

    const firstImageOf = (v: typeof ankorsVariants[number]): string | null =>
      v.images && v.images.length > 0
        ? [...v.images].sort((a, b) => a.order - b.order)[0].url
        : null;

    const linkedPairs: LinkedVariantPair[] = product.colors
      .filter((c) => !!c.ankorsVariantId)
      .map((c) => {
        const v = ankorsVariantById.get(c.ankorsVariantId as string);
        return {
          productColorId: c.id,
          colorName: c.color?.name ?? "Couleur",
          colorHex: c.color?.hex ?? null,
          patternImage: c.color?.patternImage ?? null,
          localSku: c.sku,
          localStock: c.stock ?? 0,
          localSizeName: c.variantSizes[0]?.size.name ?? null,
          ankorstoreVariantId: c.ankorsVariantId as string,
          ankorstoreVariantSku: v?.sku ?? null,
          ankorstoreVariantName: v?.name ?? "Variante introuvable côté Ankorstore",
          ankorstoreColorOption:
            v?.options?.find((o) => o.name === "color")?.value ?? null,
          ankorstoreSizeOption:
            v?.options?.find((o) => o.name === "size")?.value ?? null,
          ankorstoreWholesalePrice: v?.wholesalePrice ?? 0,
          ankorstoreStockQuantity: v?.stockQuantity ?? null,
          ankorstoreFirstImageUrl: v ? firstImageOf(v) : null,
        };
      });

    const localOrphans: LocalOrphanVariant[] = product.colors
      .filter((c) => !c.ankorsVariantId)
      .map((c) => ({
        productColorId: c.id,
        colorId: c.colorId,
        colorName: c.color?.name ?? "Couleur",
        colorHex: c.color?.hex ?? null,
        patternImage: c.color?.patternImage ?? null,
        sku: c.sku,
        stock: c.stock ?? 0,
        unitPrice: Number(c.unitPrice),
        sizeName: c.variantSizes[0]?.size.name ?? null,
      }));

    const ankorstoreOrphans: AnkorstoreOrphanVariant[] = ankorsVariants
      .filter((v) => !usedAnkorsVariantIds.has(v.id))
      .map((v) => {
        const colorOption = v.options?.find((o) => o.name === "color")?.value ?? null;
        const sizeOption = v.options?.find((o) => o.name === "size")?.value ?? null;
        return {
          ankorstoreVariantId: v.id,
          sku: v.sku,
          name: v.name,
          colorOption,
          sizeOption,
          wholesalePrice: v.wholesalePrice,
          retailPrice: v.retailPrice,
          stockQuantity: v.stockQuantity,
          firstImageUrl: firstImageOf(v),
        };
      });

    return {
      success: true,
      data: {
        ankorsProductId: product.ankorsProductId,
        ankorstoreProductName,
        localOrphans,
        ankorstoreOrphans,
        linkedPairs,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] getOrphanAnkorstoreVariants failed", { productId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Crée localement une nouvelle variante UNIT à partir d'une variante Ankorstore
 * orpheline. Récupère stock, prix, taille et images d'Ankorstore. Crée la
 * Color si elle n'existe pas (hex `#9CA3AF` par défaut). Lie immédiatement la
 * variante via `ankorsVariantId` — pas d'écrasement Ankorstore puisque c'est
 * AS qui est la source de vérité ici.
 */
export async function createLocalVariantFromAnkorstoreVariant(
  productId: string,
  ankorstoreVariantId: string,
): Promise<{ success: boolean; error?: string; createdColorId?: string; imageCount?: number }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        ankorsProductId: true,
        colors: { select: { id: true, weight: true }, where: { saleType: "UNIT" } },
      },
    });
    if (!product) return { success: false, error: "Produit introuvable." };
    if (!product.ankorsProductId) {
      return { success: false, error: "Produit non lié à Ankorstore." };
    }

    const { ankorstoreGetVariants } = await import("@/lib/ankorstore-api");
    const variants = await ankorstoreGetVariants(product.ankorsProductId);
    const akVariant = variants.find((v) => v.id === ankorstoreVariantId);
    if (!akVariant) {
      return { success: false, error: "Variante Ankorstore introuvable." };
    }

    // Vérifie qu'elle n'est pas déjà liée
    const alreadyLinked = await prisma.productColor.findFirst({
      where: { ankorsVariantId: ankorstoreVariantId },
      select: { id: true },
    });
    if (alreadyLinked) {
      return { success: false, error: "Cette variante Ankorstore est déjà liée localement." };
    }

    const colorName = akVariant.options?.find((o) => o.name === "color")?.value?.trim() || "Couleur";
    const sizeName = akVariant.options?.find((o) => o.name === "size")?.value?.trim() || "TU";
    const stock = akVariant.stockQuantity ?? 0;
    // Ankorstore GET renvoie les prix en CENTIMES (integer) — cf. spec OpenAPI
    // docs/ankorstore-spec-2026-05.yaml ligne 3690. Notre `unitPrice` local est
    // en euros HT (Decimal). On divise donc par 100 avant de stocker. La
    // prochaine synchro Ankorstore appliquera la majoration et écrasera de
    // toute façon, mais on veut stocker une valeur cohérente entre-temps
    // (sinon la fiche produit BJ affiche 480 € au lieu de 4,80 €).
    const unitPrice = Number(akVariant.wholesalePrice ?? 0) / 100;
    // Poids : on copie celui d'une variante existante du même produit, sinon 0.
    const inheritedWeight = product.colors[0]?.weight ?? 0;

    // 1) Find or create Color by name (case-insensitive match)
    const allColors = await prisma.color.findMany({ select: { id: true, name: true } });
    const normalized = colorName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();
    let color = allColors.find(
      (c) =>
        c.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim() === normalized,
    );
    if (!color) {
      color = await prisma.color.create({
        data: { name: colorName, hex: "#9CA3AF" },
        select: { id: true, name: true },
      });
    }

    // Anti-doublon : si le produit a déjà une ProductColor UNIT sur cette Color,
    // on RELIE l'existante au lieu d'en créer une nouvelle. Erreur si l'existante
    // est déjà liée à une AUTRE variante Ankorstore.
    const existingPc = await prisma.productColor.findFirst({
      where: { productId, colorId: color.id, saleType: "UNIT" },
      select: { id: true, ankorsVariantId: true },
    });
    if (existingPc) {
      if (existingPc.ankorsVariantId && existingPc.ankorsVariantId !== ankorstoreVariantId) {
        return {
          success: false,
          error: `La couleur ${colorName} est déjà liée à une autre variante Ankorstore (${existingPc.ankorsVariantId}). Délie-la d'abord si tu veux la relier à ${ankorstoreVariantId}.`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await tx.productColor.update({
          where: { id: existingPc.id },
          data: { ankorsVariantId: ankorstoreVariantId },
        });
        await tx.product.update({
          where: { id: productId },
          data: { ankorsLastSyncSnapshot: Prisma.DbNull },
        });
      });
      revalidatePath(`/admin/produits/${productId}/modifier`);
      revalidatePath(`/admin/produits`);
      revalidateTag("products", "default");
      logger.info("[Ankorstore Create Variant] ProductColor existante reliée", {
        productId,
        productColorId: existingPc.id,
        ankorstoreVariantId,
      });
      return { success: true, createdColorId: existingPc.id, imageCount: 0 };
    }

    // 2) Find or create Size by name (case-insensitive)
    let size = await prisma.size.findFirst({
      where: { name: { equals: sizeName } },
      select: { id: true, name: true },
    });
    if (!size) {
      const maxPos = await prisma.size.findFirst({
        orderBy: { position: "desc" },
        select: { position: true },
      });
      size = await prisma.size.create({
        data: { name: sizeName, position: (maxPos?.position ?? 0) + 1 },
        select: { id: true, name: true },
      });
    }

    // 3) Build SKU local
    const colorSlug = colorName.replace(/\s+/g, "-").toLowerCase();
    const nextIndex = product.colors.length + 1;
    const localSku = `${product.reference}_${colorSlug}_UNIT_${nextIndex}`;

    // 4) Télécharge et traite les images AS (best-effort)
    const { processProductImage } = await import("@/lib/image-processor");
    const { productImageDir, productImageBaseName } = await import("@/lib/storage");
    const dbPaths: { path: string; order: number }[] = [];
    if (akVariant.images && akVariant.images.length > 0) {
      const sortedImages = [...akVariant.images].sort((a, b) => a.order - b.order);
      for (let i = 0; i < sortedImages.length; i++) {
        const img = sortedImages[i];
        try {
          const resp = await fetch(img.url, { signal: AbortSignal.timeout(20_000) });
          if (!resp.ok) {
            logger.warn("[Ankorstore Create Variant] Image fetch failed", {
              url: img.url,
              status: resp.status,
            });
            continue;
          }
          const buffer = Buffer.from(await resp.arrayBuffer());
          const destDir = productImageDir(product.reference, tenant.slug);
          const baseName = productImageBaseName(product.reference, colorName, i + 1);
          const { dbPath } = await processProductImage(buffer, destDir, baseName);
          dbPaths.push({ path: dbPath, order: i + 1 });
        } catch (err) {
          logger.warn("[Ankorstore Create Variant] Image processing failed", {
            url: img.url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 5) Création transactionnelle de la ProductColor + VariantSize + images
    const created = await prisma.$transaction(async (tx) => {
      const productColor = await tx.productColor.create({
        data: {
          productId,
          colorId: color!.id,
          unitPrice,
          weight: inheritedWeight,
          stock,
          isPrimary: false,
          saleType: "UNIT",
          packQuantity: null,
          sku: localSku,
          ankorsVariantId: akVariant.id,
          variantSizes: {
            create: [{ sizeId: size!.id, quantity: stock }],
          },
        },
        select: { id: true },
      });
      // Images : 1 ligne par image, attachée à la nouvelle variante
      if (dbPaths.length > 0) {
        await tx.productColorImage.createMany({
          data: dbPaths.map((p) => ({
            productId,
            colorId: color!.id,
            productColorId: productColor.id,
            path: p.path,
            order: p.order,
          })),
        });
      }
      return productColor;
    });

    // Reset du snapshot Ankorstore pour que la prochaine sync repousse tout
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsLastSyncSnapshot: Prisma.DbNull },
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidateTag("products", "default");

    return { success: true, createdColorId: created.id, imageCount: dbPaths.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] createLocalVariantFromAnkorstoreVariant failed", {
      productId,
      ankorstoreVariantId,
      error: message,
    });
    return { success: false, error: message };
  }
}

/**
 * Lie une variante locale orpheline à une variante Ankorstore orpheline. Pose
 * `ankorsVariantId` sur la ProductColor + déclenche l'écrasement Ankorstore en
 * background (la variante reçoit notre SKU, notre taille, notre stock, nos prix).
 */
export async function linkOrphanVariantPair(
  productId: string,
  localProductColorId: string,
  ankorstoreVariantId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    const productColor = await prisma.productColor.findUnique({
      where: { id: localProductColorId },
      select: { id: true, productId: true, ankorsVariantId: true, saleType: true },
    });
    if (!productColor || productColor.productId !== productId) {
      return { success: false, error: "Variante locale introuvable." };
    }
    if (productColor.saleType !== "UNIT") {
      return { success: false, error: "Seules les variantes Unité peuvent être liées à Ankorstore." };
    }

    // Vérifie que cet ankorstoreVariantId n'est pas déjà pris par une autre variante locale.
    const alreadyUsed = await prisma.productColor.findFirst({
      where: { productId, ankorsVariantId: ankorstoreVariantId, NOT: { id: localProductColorId } },
      select: { id: true },
    });
    if (alreadyUsed) {
      return {
        success: false,
        error: "Cette variante Ankorstore est déjà liée à une autre couleur locale.",
      };
    }

    await prisma.productColor.update({
      where: { id: localProductColorId },
      data: { ankorsVariantId: ankorstoreVariantId },
    });

    // Reset du snapshot pour que la prochaine sync renvoie TOUT (y compris cette variante)
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsLastSyncSnapshot: Prisma.DbNull },
    });

    // Écrasement Ankorstore : pousse SKU/taille/stock/prix de cette variante (et des autres)
    await kickoffOverwriteFromLink(productId);

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidateTag("products", "default");

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] linkOrphanVariantPair failed", {
      productId,
      localProductColorId,
      ankorstoreVariantId,
      error: message,
    });
    return { success: false, error: message };
  }
}

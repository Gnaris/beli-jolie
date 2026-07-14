/**
 * eFashion — Publication groupée de N produits dans un seul shooting.
 *
 * Le workflow `save-mel-draft` + `save-mel-choice` côté eFashion accepte un
 * tableau `references[]`. Quand on envoie N produits dans la même requête,
 * eFashion crée **1 seul ticket de shooting** regroupant tous les produits,
 * au lieu de 1 ticket par produit (cas de figure quand on publie un par un
 * via `lib/efashion-publish.ts`).
 *
 * Ce module est appelé depuis `lib/efashion-shooting-batch-runner.ts` après
 * que l'utilisatrice valide manuellement le contenu du shooting depuis la
 * widget admin.
 *
 * Hypothèse sur l'ordre des `productIds` renvoyés par `save-mel-draft` quand
 * on envoie N références : on suppose qu'ils arrivent dans l'ordre
 * d'envoi (ref1_color1, ref1_color2, …, ref2_color1, …). Comportement
 * observé pour 1 référence ; à confirmer en prod pour N. Si un jour le
 * mapping casse, le fallback raisonnable est de re-fetcher chaque produit
 * par référence via productsPage.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  efashionSaveMelDraft,
  efashionSaveMelChoice,
  efashionCheckReferencesExist,
  type EfashionMelDraftReference,
} from "@/lib/efashion-shootings";
import { efashionUploadProductPhotos } from "@/lib/efashion-photos";
import { loadEfashionMarkup, computeEfashionPrice } from "@/lib/efashion-pricing";
import { resolveEfashionDeclinaison } from "@/lib/efashion-declinaison-matcher";
import { efashionPublishBrouillonBulk } from "@/lib/efashion-api-write";
import { efashionGetMe } from "@/lib/efashion-api";
import { resolveEfashionVendorPresets } from "@/lib/efashion-annexes";

export interface EfashionBatchPublishItemResult {
  productId: string;
  success: boolean;
  error?: string;
  efashionProductIds?: number[];
}

export interface EfashionBatchPublishOutcome {
  success: boolean;
  results: EfashionBatchPublishItemResult[];
  globalError?: string;
}

function buildDimensionsSuffix(product: {
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
}): string {
  const parts: string[] = [];
  if (product.dimensionLength != null) parts.push(`Longueur : ${product.dimensionLength}mm`);
  if (product.dimensionWidth != null) parts.push(`Largeur : ${product.dimensionWidth}mm`);
  if (product.dimensionHeight != null) parts.push(`Hauteur : ${product.dimensionHeight}mm`);
  if (product.dimensionDiameter != null) parts.push(`Diamètre : ${product.dimensionDiameter}mm`);
  if (product.dimensionCircumference != null)
    parts.push(`Circonférence : ${product.dimensionCircumference}mm`);
  if (parts.length === 0) return "";
  return `\n\nDimensions : ${parts.join(" / ")}`;
}

interface PreparedProduct {
  productId: string;
  reference: string;
  status: string;
  unitColors: Array<{
    id: string;
    colorId: string;
    efashionColorId: number;
    isPrimary: boolean;
  }>;
  draftReference: EfashionMelDraftReference;
  // images locales pour chaque couleur UNIT (path absolu BDD)
  imagesByColorId: Map<string, string[]>;
  colorNamesByColorId: Map<string, string>;
}

async function prepareProduct(productId: string): Promise<
  | { ok: true; prepared: PreparedProduct }
  | { ok: false; error: string }
> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      category: { select: { name: true, efashionCategorieId: true } },
      manufacturingCountry: { select: { name: true, efashionProvenanceId: true } },
      season: { select: { name: true, efashionCollectionId: true } },
      compositions: {
        select: {
          percentage: true,
          composition: { select: { name: true, efashionId: true } },
        },
      },
      colors: {
        select: {
          id: true,
          unitPrice: true,
          weight: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          isPrimary: true,
          color: { select: { id: true, name: true, efashionColorId: true } },
          variantSizes: {
            select: { size: { select: { name: true } } },
            orderBy: { size: { position: "asc" } },
          },
        },
      },
      translations: {
        where: { locale: { in: ["en", "it", "es", "zh"] } },
        select: { locale: true, description: true },
      },
    },
  });

  if (!product) return { ok: false, error: "Produit introuvable." };
  const unitColorsRaw = product.colors.filter((c) => c.saleType === "UNIT");
  if (unitColorsRaw.length === 0)
    return { ok: false, error: "Aucune variante à l'unité (UNIT)." };
  if (!product.category?.efashionCategorieId)
    return { ok: false, error: "Catégorie sans ID eFashion." };
  if (!product.manufacturingCountry?.efashionProvenanceId)
    return { ok: false, error: "Pays sans ID eFashion." };
  if (!product.season?.efashionCollectionId)
    return { ok: false, error: "Saison sans ID eFashion." };
  for (const pc of product.compositions) {
    if (!pc.composition.efashionId)
      return { ok: false, error: `Composition « ${pc.composition.name} » sans ID eFashion.` };
  }
  for (const c of unitColorsRaw) {
    if (!c.color?.efashionColorId)
      return { ok: false, error: `Couleur « ${c.color?.name ?? "?"} » sans ID eFashion.` };
    if (c.variantSizes.length === 0)
      return { ok: false, error: `Couleur « ${c.color?.name ?? "?"} » sans tailles.` };
  }

  // Images locales par couleur
  const allImages = await prisma.productColorImage.findMany({
    where: { productId: product.id },
    select: { colorId: true, path: true, order: true },
    orderBy: { order: "asc" },
  });
  const imagesByColorId = new Map<string, string[]>();
  for (const img of allImages) {
    const arr = imagesByColorId.get(img.colorId);
    if (arr) arr.push(img.path);
    else imagesByColorId.set(img.colorId, [img.path]);
  }

  // Résolution déclinaison
  const allBjSizeNames = Array.from(
    new Set(unitColorsRaw.flatMap((c) => c.variantSizes.map((vs) => vs.size.name))),
  );
  const declRes = await resolveEfashionDeclinaison(
    allBjSizeNames,
    product.category?.name ?? product.reference,
  );
  if (!declRes.success) return { ok: false, error: declRes.error };

  const markup = await loadEfashionMarkup();
  const primaryColor = unitColorsRaw.find((c) => c.isPrimary) ?? unitColorsRaw[0];
  const efashionPrice = computeEfashionPrice({
    basePrice: Number(primaryColor.unitPrice),
    isPack: primaryColor.saleType === "PACK",
    packQuantity: primaryColor.packQuantity,
    markup,
  });

  const transByLocale = new Map(
    product.translations.map((t) => [t.locale, t.description]),
  );
  const dimensionsSuffix = buildDimensionsSuffix(product);
  const descriptionFr = (product.description ?? "") + dimensionsSuffix;
  const descriptionEn =
    (transByLocale.get("en") ?? product.description ?? "") + dimensionsSuffix;
  const descriptionIt =
    (transByLocale.get("it") ?? product.description ?? "") + dimensionsSuffix;
  const descriptionEs =
    (transByLocale.get("es") ?? product.description ?? "") + dimensionsSuffix;
  const descriptionZh =
    transByLocale.get("zh") != null
      ? transByLocale.get("zh")! + dimensionsSuffix
      : null;

  const couleurs = unitColorsRaw.map((c, i) => ({
    id: c.color!.efashionColorId as number,
    nom: c.color!.name,
    isMain: c.isPrimary || (i === 0 && !unitColorsRaw.some((x) => x.isPrimary)),
  }));
  const compositions = product.compositions.map((pc) => ({
    id: pc.composition.efashionId as number,
    localisationId: 4,
    percentage: pc.percentage,
  }));

  // Résolution des IDs propres au vendeur eFashion courant (id_vendeur_marque
  // + id_pack). Ces IDs varient d'une boutique à l'autre — impossible à
  // hardcoder. Voir `resolveEfashionVendorPresets` pour la logique de lookup.
  const desiredPackQuantity = primaryColor.packQuantity ?? 1;
  const presets = await resolveEfashionVendorPresets(desiredPackQuantity);
  if ("error" in presets) return { ok: false, error: presets.error };

  const draftReference: EfashionMelDraftReference = {
    id: `bj-${productId}-${Date.now()}`,
    reference: product.reference,
    marque: String(presets.marque),
    poids: String(primaryColor.weight),
    categorie: String(product.category!.efashionCategorieId!),
    venduPar: unitColorsRaw.length > 1 ? "couleurs" : "tailles",
    collection: String(product.season!.efashionCollectionId!),
    paysOrigine: String(product.manufacturingCountry!.efashionProvenanceId!),
    taillePaquet: String(declRes.match.declinaisonId),
    quantitePaquet: String(presets.pack),
    stock: "",
    prix: String(efashionPrice),
    prixReduit: "",
    dateRemise: "2037-12-31",
    pourcentageRemise: "0",
    dimensions: "",
    minimumCommande: "",
    descriptionFr,
    descriptionEn,
    descriptionIt,
    descriptionEs,
    descriptionZh,
    couleurs,
    compositions,
    caracteristiques: [],
  };

  const colorNamesByColorId = new Map<string, string>();
  for (const c of unitColorsRaw) {
    if (c.color?.id) colorNamesByColorId.set(c.color.id, c.color.name);
  }

  return {
    ok: true,
    prepared: {
      productId,
      reference: product.reference,
      status: product.status,
      unitColors: unitColorsRaw.map((c) => ({
        id: c.id,
        colorId: c.color!.id,
        efashionColorId: c.color!.efashionColorId as number,
        isPrimary: c.isPrimary,
      })),
      draftReference,
      imagesByColorId,
      colorNamesByColorId,
    },
  };
}

/**
 * Publie N produits en un seul shooting eFashion.
 * Les produits ayant des erreurs de préparation sont rejetés mais n'empêchent
 * pas les autres de partir. Si tous échouent → globalError + success=false.
 */
export async function efashionPublishProductsBatch(
  productIds: string[],
): Promise<EfashionBatchPublishOutcome> {
  if (productIds.length === 0) {
    return { success: true, results: [] };
  }

  const results: EfashionBatchPublishItemResult[] = [];
  const prepared: PreparedProduct[] = [];

  // 1. Prépare chaque produit (validation + collecte des données)
  for (const productId of productIds) {
    const prep = await prepareProduct(productId);
    if (!prep.ok) {
      results.push({ productId, success: false, error: prep.error });
    } else {
      prepared.push(prep.prepared);
    }
  }

  if (prepared.length === 0) {
    return {
      success: false,
      results,
      globalError: "Aucun produit n'a passé la préparation.",
    };
  }

  // 2. Vérifie en batch que les références n'existent pas déjà côté eFashion
  try {
    const refCheck = await efashionCheckReferencesExist(
      prepared.map((p) => ({
        reference: p.draftReference.reference,
        venduPar: p.draftReference.venduPar,
      })),
    );
    const existingRefs = new Set(
      refCheck.results.filter((r) => r.exists).map((r) => r.reference),
    );
    if (existingRefs.size > 0) {
      // Filtre ceux qui existent déjà — résultat individuel + ne pas les envoyer
      const filtered: PreparedProduct[] = [];
      for (const p of prepared) {
        if (existingRefs.has(p.reference)) {
          results.push({
            productId: p.productId,
            success: false,
            error:
              `La référence « ${p.reference} » existe déjà chez eFashion. ` +
              "Utilisez « Lier à un produit eFashion existant » pour la rattacher.",
          });
        } else {
          filtered.push(p);
        }
      }
      if (filtered.length === 0) {
        return {
          success: false,
          results,
          globalError: "Toutes les références existent déjà côté eFashion.",
        };
      }
      prepared.length = 0;
      prepared.push(...filtered);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // CRITIQUE : sans ces push, le runner reçoit un tableau vide et laisse les
    // MarketplaceRefreshJob bloqués en IN_PROGRESS pour toujours (incident
    // Issyma 14/07/2026 — token 401 → check-references throw → 2 produits
    // coincés dans le widget eFashion).
    for (const p of prepared) {
      results.push({
        productId: p.productId,
        success: false,
        error: `check-references-exists : ${msg}`,
      });
    }
    return {
      success: false,
      results,
      globalError: `Échec de la pré-vérification des références : ${msg}`,
    };
  }

  // 3. saveMelDraft groupé — UN SEUL appel pour tous les produits
  let draftResult: { success: boolean; productIds: number[]; message?: string };
  try {
    draftResult = await efashionSaveMelDraft({
      references: prepared.map((p) => p.draftReference),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const p of prepared) {
      results.push({ productId: p.productId, success: false, error: `save-mel-draft : ${msg}` });
    }
    return { success: false, results, globalError: `Échec save-mel-draft : ${msg}` };
  }
  if (!draftResult.success || draftResult.productIds.length === 0) {
    for (const p of prepared) {
      results.push({
        productId: p.productId,
        success: false,
        error: draftResult.message ?? "save-mel-draft a échoué",
      });
    }
    return {
      success: false,
      results,
      globalError: draftResult.message ?? "save-mel-draft a échoué",
    };
  }

  // 4. Distribue les productIds renvoyés par couleur de chaque BJ product
  // On suppose un ordre stable : ref1_col1, ref1_col2, ..., ref2_col1, ...
  const allReturned = draftResult.productIds;
  const expectedTotal = prepared.reduce((sum, p) => sum + p.unitColors.length, 0);
  if (allReturned.length !== expectedTotal) {
    logger.warn("[eFashion batch publish] productIds count mismatch", {
      expected: expectedTotal,
      got: allReturned.length,
    });
  }

  let cursor = 0;
  const idsByProduct = new Map<string, number[]>();
  for (const p of prepared) {
    const slice = allReturned.slice(cursor, cursor + p.unitColors.length);
    idsByProduct.set(p.productId, slice);
    cursor += p.unitColors.length;
  }

  // 5. saveMelChoice groupé — UN SEUL appel → 1 shooting créé
  const choiceRefs = prepared.flatMap((p) => {
    const efIds = idsByProduct.get(p.productId) ?? [];
    return efIds.map((pid) => ({ ...p.draftReference, id: `db-${pid}` }));
  });
  try {
    await efashionSaveMelChoice({ references: choiceRefs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Le draft est passé mais le choice a planté → les fiches existent côté
    // eFashion mais aucun shooting créé. On enregistre quand même les IDs en
    // BDD pour permettre un alignement manuel par la suite.
    logger.error("[eFashion batch publish] save-mel-choice failed", {
      error: err as Error,
      affected: prepared.map((p) => p.productId),
    });
    await persistIds(prepared, idsByProduct);
    for (const p of prepared) {
      results.push({
        productId: p.productId,
        success: false,
        error: `Brouillon créé mais save-mel-choice a échoué : ${msg}`,
        efashionProductIds: idsByProduct.get(p.productId),
      });
    }
    return { success: false, results, globalError: `save-mel-choice : ${msg}` };
  }

  // 6. Upload des photos par produit (loop séquentielle pour ne pas saturer)
  for (const p of prepared) {
    const efIds = idsByProduct.get(p.productId) ?? [];
    for (let i = 0; i < p.unitColors.length && i < efIds.length; i++) {
      const colorRef = p.unitColors[i];
      const efId = efIds[i];
      const paths = p.imagesByColorId.get(colorRef.colorId) ?? [];
      if (paths.length === 0) continue;
      try {
        await efashionUploadProductPhotos(
          efId,
          paths.map((path, idx) => ({
            dbPath: path,
            filename: `${p.reference}-${p.colorNamesByColorId.get(colorRef.colorId) ?? "color"}-${idx + 1}.jpg`,
          })),
        );
      } catch (err) {
        logger.warn("[eFashion batch publish] photo upload failed (non-blocking)", {
          productId: p.productId,
          efashionProductId: efId,
          error: err,
        });
      }
    }
  }

  // 7. Persiste les IDs en BDD
  await persistIds(prepared, idsByProduct);

  // 8. publishBrouillonBulk — un seul appel pour TOUS les productIds créés
  const allEfIds = prepared.flatMap((p) => idsByProduct.get(p.productId) ?? []);
  try {
    const me = await efashionGetMe();
    const publishedCount = await efashionPublishBrouillonBulk({
      idProduits: allEfIds,
      idVendeur: me.id_vendeur,
    });
    logger.info("[eFashion batch publish] Sortie du brouillon", {
      totalProducts: prepared.length,
      totalColors: allEfIds.length,
      publishedCount,
    });
  } catch (err) {
    logger.warn("[eFashion batch publish] publishBrouillonBulk a planté (non bloquant)", {
      error: err as Error,
    });
  }

  // 9. Alignement par couleur — boucle par produit BJ
  const { efashionUpdateProductInPlace } = await import("@/lib/efashion-update");
  for (const p of prepared) {
    try {
      const alignRes = await efashionUpdateProductInPlace(p.productId, { forceFullSync: true });
      if (!alignRes.success) {
        logger.warn("[eFashion batch publish] Alignement en erreur", {
          productId: p.productId,
          error: alignRes.error,
        });
      }
    } catch (err) {
      logger.warn("[eFashion batch publish] Alignement a planté (non bloquant)", {
        productId: p.productId,
        error: err as Error,
      });
    }
  }

  for (const p of prepared) {
    results.push({
      productId: p.productId,
      success: true,
      efashionProductIds: idsByProduct.get(p.productId),
    });
  }

  return { success: true, results };
}

async function persistIds(
  prepared: PreparedProduct[],
  idsByProduct: Map<string, number[]>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const p of prepared) {
      const efIds = idsByProduct.get(p.productId) ?? [];
      await tx.product.update({
        where: { id: p.productId },
        data: {
          efashionReferenceBase: p.reference,
          efashionLastSyncSnapshot: Prisma.DbNull,
          efashionLastRefreshedAt: new Date(),
        },
      });
      for (let i = 0; i < p.unitColors.length && i < efIds.length; i++) {
        await tx.productColor.update({
          where: { id: p.unitColors[i].id },
          data: { efashionProductId: efIds[i] },
        });
      }
    }
  });
}

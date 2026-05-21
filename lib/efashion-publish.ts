/**
 * eFashion Paris — Première publication d'un produit (Lot 4).
 *
 * Flux complet du workflow shooting (cf. docs/efashion-api.md §3) :
 *   1. Charge le produit BJ + toutes ses dépendances (couleurs, tailles, catégorie,
 *      pays, saison, compositions) avec les mappings eFashion (efashion* fields).
 *   2. Valide que TOUS les mappings nécessaires sont renseignés. Sinon, erreur
 *      claire à l'utilisatrice.
 *   3. Vérifie que la référence n'existe pas déjà chez eFashion.
 *   4. Appelle `saveMelDraft` → reçoit 1 productId par couleur.
 *   5. Appelle `saveMelChoice` avec melOption="upload".
 *   6. Upload les photos de chaque couleur.
 *   7. Stocke les IDs en BDD (Product.efashionReferenceBase + ProductColor.efashionProductId).
 *
 * ⚠️ Mode prudent (validation cliente) : si une donnée requise manque, on échoue
 * AVANT le premier appel à eFashion — pas de pollution côté eux.
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

export interface EfashionPublishOutcome {
  success: boolean;
  error?: string;
  productIds?: number[];
  referenceBase?: string;
}

export async function efashionPublishProduct(
  productId: string,
): Promise<EfashionPublishOutcome> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      efashionReferenceBase: true,
      category: { select: { id: true, name: true, efashionCategorieId: true } },
      manufacturingCountry: { select: { id: true, name: true, efashionProvenanceId: true } },
      season: { select: { id: true, name: true, efashionCollectionId: true } },
      compositions: {
        select: {
          percentage: true,
          composition: { select: { id: true, name: true, efashionId: true } },
        },
      },
      colors: {
        select: {
          id: true,
          efashionProductId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          isPrimary: true,
          disabled: true,
          color: {
            select: { id: true, name: true, efashionColorId: true },
          },
          variantSizes: {
            select: {
              quantity: true,
              size: {
                select: { id: true, name: true, efashionDeclinaisonId: true },
              },
            },
            orderBy: { size: { position: "asc" } },
          },
          images: {
            select: { path: true, order: true },
            orderBy: { order: "asc" },
          },
        },
      },
      translations: {
        where: { locale: { in: ["en", "it", "es", "zh"] } },
        select: { locale: true, description: true },
      },
    },
  });

  if (!product) return { success: false, error: "Produit introuvable." };
  if (product.colors.length === 0)
    return { success: false, error: "Le produit n'a aucune couleur." };

  // Validations centralisées — on liste TOUT ce qui manque pour donner un retour clair.
  // ⚠️ Les tailles ne sont PLUS validées au niveau Size.efashionDeclinaisonId :
  // la déclinaison est résolue dynamiquement (cf. resolveEfashionDeclinaison ci-dessous).
  const missing: string[] = [];
  if (!product.category?.efashionCategorieId)
    missing.push(`catégorie « ${product.category?.name ?? "?"} » sans id eFashion`);
  if (!product.manufacturingCountry?.efashionProvenanceId)
    missing.push(`pays « ${product.manufacturingCountry?.name ?? "?"} » sans id eFashion`);
  if (!product.season?.efashionCollectionId)
    missing.push(`saison « ${product.season?.name ?? "?"} » sans id eFashion`);
  if (product.compositions.length === 0) missing.push("au moins 1 composition");
  for (const pc of product.compositions) {
    if (!pc.composition.efashionId)
      missing.push(`composition « ${pc.composition.name} » sans id eFashion`);
  }
  for (const c of product.colors) {
    if (!c.color?.efashionColorId)
      missing.push(`couleur « ${c.color?.name ?? "?"} » sans id eFashion`);
    if (c.variantSizes.length === 0)
      missing.push(`couleur « ${c.color?.name ?? "?"} » sans tailles`);
  }

  if (missing.length > 0) {
    return {
      success: false,
      error:
        "Mappings eFashion manquants — renseignez d'abord ces correspondances :\n" +
        missing.map((m) => "• " + m).join("\n"),
    };
  }

  // Résolution dynamique de la déclinaison : on prend l'union des tailles de
  // toutes les couleurs et on cherche une déclinaison eFashion qui les couvre.
  // Si rien ne convient, on auto-crée une nouvelle déclinaison.
  const allBjSizeNames = Array.from(
    new Set(
      product.colors.flatMap((c) => c.variantSizes.map((vs) => vs.size.name)),
    ),
  );
  const declRes = await resolveEfashionDeclinaison(
    allBjSizeNames,
    product.category?.name ?? product.reference,
  );
  if (!declRes.success) {
    return { success: false, error: declRes.error };
  }
  const declMatch = declRes.match;

  // Calcul du prix
  const markup = await loadEfashionMarkup();
  const primaryColor = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const efashionPrice = computeEfashionPrice({
    basePrice: Number(primaryColor.unitPrice),
    isPack: primaryColor.saleType === "PACK",
    packQuantity: primaryColor.packQuantity,
    markup,
  });

  // Vérifie que la référence n'existe pas déjà côté eFashion
  const venduPar: "couleurs" | "tailles" =
    product.colors.length > 1 ? "couleurs" : "tailles";
  const refCheck = await efashionCheckReferencesExist([
    { reference: product.reference, venduPar },
  ]);
  if (refCheck.results.find((r) => r.reference === product.reference)?.exists) {
    return {
      success: false,
      error:
        `La référence « ${product.reference} » existe déjà chez eFashion. ` +
        "Utilisez « Lier à un produit eFashion existant » pour la rattacher.",
    };
  }

  // Descriptions multilingues
  const transByLocale = new Map(product.translations.map((t) => [t.locale, t.description]));
  const descriptionFr = product.description ?? "";
  const descriptionEn = transByLocale.get("en") ?? descriptionFr;
  const descriptionIt = transByLocale.get("it") ?? descriptionFr;
  const descriptionEs = transByLocale.get("es") ?? descriptionFr;
  const descriptionZh = transByLocale.get("zh") ?? null;

  const couleurs = product.colors.map((c, i) => ({
    id: c.color!.efashionColorId as number,
    nom: c.color!.name,
    isMain: c.isPrimary || (i === 0 && !product.colors.some((x) => x.isPrimary)),
  }));
  const compositions = product.compositions.map((pc) => ({
    id: pc.composition.efashionId as number,
    localisationId: 4, // observé dans la capture, valeur par défaut (à confirmer si plusieurs zones)
    percentage: pc.percentage,
  }));

  const reference: EfashionMelDraftReference = {
    id: `bj-${productId}-${Date.now()}`,
    reference: product.reference,
    marque: "3228", // BJ id_vendeur_marque (observé dans la capture pour vendeur 2017)
    poids: String(primaryColor.weight),
    categorie: String(product.category!.efashionCategorieId!),
    venduPar,
    collection: String(product.season!.efashionCollectionId!),
    paysOrigine: String(product.manufacturingCountry!.efashionProvenanceId!),
    taillePaquet: String(declMatch.declinaisonId), // résolu dynamiquement
    quantitePaquet: String(primaryColor.packQuantity ?? 12744), // 12744 = pack 1 unité observé (à affiner)
    stock: "",
    prix: String(efashionPrice),
    prixReduit: "",
    dateRemise: "2099-12-31",
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

  // Étape 4 : save-mel-draft
  let draftResult: { success: boolean; productIds: number[]; message?: string };
  try {
    draftResult = await efashionSaveMelDraft({ references: [reference] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Échec save-mel-draft : ${msg}` };
  }
  if (!draftResult.success || draftResult.productIds.length === 0) {
    return { success: false, error: draftResult.message ?? "save-mel-draft a échoué" };
  }

  const productIds = draftResult.productIds;
  if (productIds.length !== couleurs.length) {
    logger.warn("[eFashion publish] productIds count mismatch", {
      expected: couleurs.length,
      got: productIds.length,
    });
  }

  // Étape 5 : save-mel-choice (option upload)
  const choiceRefs = productIds.map((pid) => ({ ...reference, id: `db-${pid}` }));
  try {
    await efashionSaveMelChoice({ references: choiceRefs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Brouillon créé (productIds=${productIds.join(",")}) mais save-mel-choice a échoué : ${msg}`,
    };
  }

  // Étape 6 : upload des photos — 1 batch par couleur
  // L'ordre des `productIds` correspond à l'ordre des `couleurs` envoyées dans le draft.
  for (let i = 0; i < product.colors.length && i < productIds.length; i++) {
    const local = product.colors[i];
    const efId = productIds[i];
    if (local.images.length === 0) continue;
    try {
      await efashionUploadProductPhotos(
        efId,
        local.images.map((img, idx) => ({
          dbPath: img.path,
          filename: `${product.reference}-${local.color?.name ?? "color"}-${idx + 1}.jpg`,
        })),
      );
    } catch (err) {
      logger.warn("[eFashion publish] photo upload failed (non-blocking)", {
        productId,
        efashionProductId: efId,
        error: err,
      });
    }
  }

  // Étape 7 : sauvegarde des IDs en BDD
  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: {
        efashionReferenceBase: product.reference,
        efashionLastSyncSnapshot: Prisma.DbNull, // force un resync à la prochaine sync
        efashionLastRefreshedAt: new Date(),
      },
    });
    for (let i = 0; i < product.colors.length && i < productIds.length; i++) {
      await tx.productColor.update({
        where: { id: product.colors[i].id },
        data: { efashionProductId: productIds[i] },
      });
    }
  });

  return {
    success: true,
    productIds,
    referenceBase: product.reference,
  };
}

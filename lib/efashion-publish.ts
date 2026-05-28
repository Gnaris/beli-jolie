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
import { efashionPublishBrouillonBulk } from "@/lib/efashion-api-write";
import { efashionGetMe } from "@/lib/efashion-api";

/**
 * Construit le suffixe « Dimensions : ... » ajouté à la description envoyée
 * à eFashion. Format identique à PFS (cf. lib/pfs-publish.ts) pour cohérence
 * entre les 2 marketplaces.
 */
function buildEfashionDimensionsSuffix(product: {
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
  if (product.dimensionCircumference != null) parts.push(`Circonférence : ${product.dimensionCircumference}mm`);
  if (parts.length === 0) return "";
  return `\n\nDimensions : ${parts.join(" / ")}`;
}

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
      // Dimensions — copiées dans la description envoyée à eFashion (même
      // format que PFS, cf. lib/pfs-publish.ts::buildDimensionsSuffix).
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
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
          // ⚠️ Pas via la relation `images` : les `ProductColorImage` créées
          // depuis l'admin moderne ont `productColorId = NULL`, donc la relation
          // les rate. On charge séparément via (productId, colorId) plus bas.
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

  // Images du produit — chargées séparément via (productId, colorId) parce
  // que la relation `ProductColor.images` rate les images créées par l'admin
  // moderne (où `productColorId = NULL`).
  const allImages = await prisma.productColorImage.findMany({
    where: { productId: product.id },
    select: { colorId: true, path: true, order: true },
    orderBy: { order: "asc" },
  });
  const imagesByColorId = new Map<string, Array<{ path: string; order: number }>>();
  for (const img of allImages) {
    const arr = imagesByColorId.get(img.colorId);
    if (arr) arr.push({ path: img.path, order: img.order });
    else imagesByColorId.set(img.colorId, [{ path: img.path, order: img.order }]);
  }

  // eFashion ne gère qu'1 ligne par couleur (pas de notion UNIT/PACK).
  // On reproduit la règle Ankorstore : seules les variantes UNIT sont
  // synchronisées. Les packs sont ignorés silencieusement.
  product.colors = product.colors.filter((c) => c.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      success: false,
      error:
        "Aucune variante à l'unité — eFashion ne synchronise que les variantes vendues à l'unité (les packs sont ignorés). Ajoutez au moins une variante de type Unité pour publier sur eFashion.",
    };
  }

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
  // ⚠️ La description FR envoyée à eFashion inclut le suffix dimensions
  // (même format que PFS) si le produit a au moins une dimension renseignée.
  // Les traductions multilingues passent telles quelles — eFashion les
  // retraduira au prochain `saveProduitDescription` (cf. efashion-update.ts).
  const transByLocale = new Map(product.translations.map((t) => [t.locale, t.description]));
  const dimensionsSuffix = buildEfashionDimensionsSuffix(product);
  const descriptionFr = (product.description ?? "") + dimensionsSuffix;
  const descriptionEn = (transByLocale.get("en") ?? product.description ?? "") + dimensionsSuffix;
  const descriptionIt = (transByLocale.get("it") ?? product.description ?? "") + dimensionsSuffix;
  const descriptionEs = (transByLocale.get("es") ?? product.description ?? "") + dimensionsSuffix;
  const descriptionZh = transByLocale.get("zh") != null
    ? transByLocale.get("zh")! + dimensionsSuffix
    : null;

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
    // ⚠️ La colonne MySQL `produits_remises.date_remise` est en TIMESTAMP — la
    // valeur max acceptée est 2038-01-19. "2099-12-31" est rejetée
    // (ER_TRUNCATED_WRONG_VALUE). On utilise "2037-12-31" comme placeholder
    // « pas de remise » très lointain mais sûr.
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
    const localImages = local.color?.id ? (imagesByColorId.get(local.color.id) ?? []) : [];
    if (localImages.length === 0) continue;
    try {
      await efashionUploadProductPhotos(
        efId,
        localImages.map((img, idx) => ({
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

  // Étape 8 : sortie automatique du statut "brouillon".
  // saveMelDraft + saveMelChoice livrent la fiche en `premel='0'` (brouillon
  // côté catalogue acheteurs) même quand tout est complet. Sans
  // `publishBrouillon`, le produit n'apparait jamais en ligne et l'admin doit
  // aller cliquer manuellement sur "Mettre en ligne" dans l'UI eFashion.
  // ⚠️ Doit être fait AVANT l'étape 9 (alignement) : `publishBrouillonBulk`
  // remet `visible=true` au moment de sortir du brouillon. Sinon, le
  // `visible=false` posé par l'alignement (cas produit local OFFLINE/ARCHIVED)
  // se ferait écraser et la fiche resterait visible côté acheteurs.
  // Best-effort : si ça plante, le publish reste success — l'admin peut
  // toujours publier manuellement.
  try {
    const me = await efashionGetMe();
    const publishedCount = await efashionPublishBrouillonBulk({
      idProduits: productIds,
      idVendeur: me.id_vendeur,
    });
    logger.info("[eFashion publish] Sortie du brouillon", {
      productId,
      localStatus: product.status,
      totalColors: productIds.length,
      publishedCount,
      idProduits: productIds,
    });
  } catch (err) {
    logger.warn("[eFashion publish] publishBrouillonBulk a planté (non bloquant)", {
      productId,
      error: err as Error,
    });
  }

  // Étape 9 : alignement des attributs par couleur (prix, poids, stock,
  // visibilité). `saveMelDraft` n'accepte qu'**un seul prix** pour toutes les
  // couleurs (= celui de la couleur principale), donc à ce stade toutes les
  // lignes eFashion ont le prix de la principale. On enchaîne avec un
  // `efashionUpdateProductInPlace` forceFullSync pour pousser les prix/poids
  // spécifiques à chaque couleur — ET pour reposer `visible=false` après que
  // `publishBrouillonBulk` (étape 8) ait basculé toutes les variantes à
  // `visible=true`. Best-effort : si ça plante, le publish reste success
  // (l'admin peut relancer un sync manuel pour rattraper).
  try {
    const { efashionUpdateProductInPlace } = await import("@/lib/efashion-update");
    const alignRes = await efashionUpdateProductInPlace(productId, { forceFullSync: true });
    if (!alignRes.success) {
      logger.warn("[eFashion publish] Alignement par couleur en erreur", {
        productId,
        error: alignRes.error,
      });
    } else {
      logger.info("[eFashion publish] Alignement par couleur OK", {
        productId,
        variantsUpdated: alignRes.variantsUpdated,
        stockMutations: alignRes.stockMutationsCount,
      });
    }
  } catch (err) {
    logger.warn("[eFashion publish] Alignement par couleur a planté (non bloquant)", {
      productId,
      error: err as Error,
    });
  }

  return {
    success: true,
    productIds,
    referenceBase: product.reference,
  };
}

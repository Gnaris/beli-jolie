/**
 * eFashion Paris — Mise à jour ciblée d'un produit lié (Lot 3).
 *
 * Pré-requis : le produit doit déjà être lié côté eFashion via la modale
 * "Lier à un produit eFashion existant" (Lot 2). Chaque ProductColor a son
 * `efashionProductId`.
 *
 * Flux :
 *   1. Charge le produit + variantes liées
 *   2. Construit le snapshot cible (état désiré côté eFashion)
 *   3. Diff vs `Product.efashionLastSyncSnapshot`
 *   4. Pour chaque variant modifié : `efashionUpdateProduit` (visible, prix, poids)
 *   5. Pour le stock : `efashionSaveProduitStocks` en batch par efashionProductId
 *   6. Si la description multilingue a changé : `efashionSaveProduitDescription`
 *      par variante liée (1 appel par efashionProductId)
 *   7. Sauvegarde le snapshot
 *
 * Pas de fallback automatique sur publish — si la liaison est rompue, on
 * remonte l'erreur à l'admin pour qu'elle re-lie manuellement.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  efashionUpdateProduit,
  efashionSaveProduitStocks,
  efashionSaveProduitDescription,
  efashionSaveProduitCompositions,
  efashionTranslateText,
  efashionToggleMainProduct,
  efashionDuplicateWithNewColor,
  efashionPublishBrouillon,
  efashionSoftDeleteProduits,
} from "@/lib/efashion-api-write";
import {
  efashionGetProductPhotos,
  efashionDeleteProductPhoto,
  efashionUploadProductPhotos,
} from "@/lib/efashion-photos";
import {
  diffEfashionSnapshots,
  hasAnyChanges,
  type EfashionCompositionSnapshot,
  type EfashionDescriptions,
  type EfashionSnapshot,
  type EfashionVariantSnapshot,
} from "@/lib/efashion-sync-diff";
import { loadEfashionMarkup, computeEfashionPrice } from "@/lib/efashion-pricing";

interface UpdateOpts {
  /** Si true, ignore le snapshot existant et renvoie tout — équivalent du « Resync » côté UI. */
  forceFullSync?: boolean;
}

/**
 * Construit le suffixe « Dimensions : Longueur : 12mm / Largeur : 8mm / ... »
 * ajouté à la description française envoyée à eFashion. Format identique à
 * PFS (cf. lib/pfs-publish.ts::buildDimensionsSuffix) pour que les 2
 * marketplaces voient la même chose en bas de la fiche.
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

export interface EfashionUpdateOutcome {
  success: boolean;
  error?: string;
  /** Nombre de variantes envoyées (mutations executées). */
  variantsUpdated?: number;
  stockMutationsCount?: number;
  /** Variants qui n'étaient pas liés et qu'on n'a pas pu mettre à jour. */
  unlinkedVariants?: number;
  /** Nombre d'appels `saveProduitDescription` réussis (1 par variante liée). */
  descriptionsUpdatedCount?: number;
  /** Nombre d'appels `saveProduitCompositions` réussis (1 par variante liée). */
  compositionsUpdatedCount?: number;
  /** Nombre de variantes dont les photos eFashion ont été resynchronisées. */
  imagesUpdatedCount?: number;
  /** Nombre de couleurs supprimées côté eFashion (correspond à `diff.removed`). */
  colorsDeletedCount?: number;
  /**
   * Nombre de couleurs créées côté eFashion via `duplicateWithNewColor` +
   * `publishBrouillon` (couleurs locales sans `efashionProductId` qu'on a
   * propagées vers eFashion pendant ce cycle de sync).
   */
  colorsCreatedCount?: number;
  /**
   * Nombre de couleurs ajoutées localement qu'on a été incapable de créer côté
   * eFashion via une simple mise à jour (eFashion n'a pas d'endpoint « ajouter
   * une couleur » propre — il faut un Rafraîchir complet). L'erreur remontée
   * dans `error` invite l'utilisatrice à relancer un Rafraîchir.
   */
  colorsSkippedCount?: number;
  noChanges?: boolean;
}

export async function efashionUpdateProductInPlace(
  productId: string,
  opts: UpdateOpts = {},
): Promise<EfashionUpdateOutcome> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      status: true,
      description: true,
      // Dimensions — copiées dans la description envoyée à eFashion (même
      // format que PFS, cf. lib/pfs-publish.ts::buildDimensionsSuffix).
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      efashionReferenceBase: true,
      efashionLastSyncSnapshot: true,
      // Couleur principale BJ — source de vérité pour la sync eFashion.
      // ⚠️ Ne pas se fier à `ProductColor.isPrimary` qui peut être
      // désynchronisé de `Product.primaryColorId` (cas observé : l'admin
      // change la principale mais seul le champ produit est mis à jour).
      primaryColorId: true,
      compositions: {
        select: {
          percentage: true,
          composition: { select: { name: true, efashionId: true } },
        },
      },
      colors: {
        select: {
          id: true,
          colorId: true,
          efashionProductId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          disabled: true,
          isPrimary: true,
          variantSizes: {
            select: {
              quantity: true,
              size: { select: { name: true } },
            },
          },
          // Nom et id eFashion de la couleur — nécessaires pour
          // `duplicateWithNewColor` quand on crée une nouvelle couleur côté
          // eFashion (cf. section « auto-création » plus bas).
          color: {
            select: { name: true, efashionColorId: true },
          },
          // ⚠️ Pas via la relation `images` : les `ProductColorImage` créées
          // depuis l'admin moderne ont `productColorId = NULL` (cf. commentaire
          // dans app/actions/admin/products.ts), donc la relation ne les voit
          // pas. On charge les images séparément via (productId, colorId).
        },
      },
    },
  });
  if (!product) return { success: false, error: "Produit introuvable" };
  if (!product.efashionReferenceBase) {
    return { success: false, error: "Produit non lié à eFashion (référence manquante)" };
  }

  // Images du produit, indexées par colorId — on lit toutes les
  // `ProductColorImage` du produit (avec ou sans `productColorId`) parce que
  // les images créées via l'admin moderne ont `productColorId = NULL` et
  // seraient invisibles via la relation `ProductColor.images`.
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

  const markup = await loadEfashionMarkup();

  // Snapshot précédent — utilisé en plusieurs endroits (auto-création des
  // couleurs, fallback main, diff). Déclaré tôt pour partager.
  const previousSnapshot = opts.forceFullSync
    ? null
    : (product.efashionLastSyncSnapshot as EfashionSnapshot | null);

  // eFashion ne synchronise que les variantes UNIT. Une variante PACK qui
  // posséderait un efashionProductId (cas legacy avant le script de migration)
  // est explicitement ignorée ici.
  const unitColors = product.colors.filter((c) => c.saleType === "UNIT");

  // ─────────────────────────────────────────────────────────────────────
  // État live eFashion — partagé entre auto-création des couleurs et le
  // reste du flow. Fetch unique en lazy (premier appel à ensureLiveById).
  // ─────────────────────────────────────────────────────────────────────
  type LiveItem = {
    reference: string;
    reference_base: string | null;
    id_collection: number | null;
    id_categorie: number | null;
    id_provenance: number | null;
    id_declinaison: number | null;
    id_pack: number | null;
    vendu_par: string | null;
    id_vendeur_marque: number | null;
    main: boolean;
  };
  let liveById = new Map<number, LiveItem>();
  let efashionVendorId: number | null = null;
  let liveFetched = false;
  async function ensureLiveById(): Promise<void> {
    if (liveFetched) return;
    liveFetched = true;
    try {
      const { efashionGetMe, efashionListProducts } = await import("@/lib/efashion-api");
      const me = await efashionGetMe();
      efashionVendorId = me.id_vendeur;
      const list = await efashionListProducts({
        idVendeur: me.id_vendeur,
        take: 100,
        reference: product!.efashionReferenceBase!,
        premelFilter: "en_ligne",
      });
      for (const it of list.items) {
        if (
          (it.reference_base ?? "").toLowerCase().trim() !==
          product!.efashionReferenceBase!.toLowerCase().trim()
        ) {
          continue;
        }
        liveById.set(it.id_produit, {
          reference: it.reference,
          reference_base: it.reference_base ?? null,
          id_collection: it.id_collection ?? null,
          id_categorie: it.id_categorie ?? null,
          id_provenance: it.id_provenance ?? null,
          id_declinaison: it.id_declinaison ?? null,
          id_pack: it.id_pack ?? null,
          vendu_par: it.vendu_par ?? null,
          id_vendeur_marque: it.id_vendeur_marque ?? null,
          main: it.main === true,
        });
      }
      logger.info("[eFashion update] État eFashion lu pour completion du payload", {
        productId,
        liveVariants: liveById.size,
      });
    } catch (err) {
      logger.warn("[eFashion update] Lecture live eFashion KO, payload réduit", {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
      liveById = new Map();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Auto-création des couleurs locales pas encore connues d'eFashion
  // ─────────────────────────────────────────────────────────────────────
  // Si l'utilisatrice a ajouté une nouvelle couleur depuis l'admin, sa
  // `ProductColor.efashionProductId` est null. On utilise la mutation
  // `duplicateWithNewColor` (vue dans le HAR de leur UI — mai 2026) qui
  // clone la couleur main du groupe en gardant la même reference_base et
  // crée un nouvel id_produit dédié. Ensuite : upload photos +
  // `publishBrouillon` pour rendre la nouvelle couleur visible côté
  // catalogue acheteurs.
  //
  // Pré-requis pour qu'une couleur soit créée :
  //   - `efashionColorId` renseigné (mapping de bibliothèque)
  //   - couleur non `disabled`
  //   - une couleur source côté eFashion (main + référence) connue
  let colorsCreatedCount = 0;
  const createErrors: string[] = [];
  const colorsToCreate = unitColors.filter(
    (c) =>
      c.efashionProductId === null &&
      !c.disabled &&
      c.color?.efashionColorId != null,
  );

  if (colorsToCreate.length > 0) {
    await ensureLiveById();
    if (efashionVendorId === null) {
      createErrors.push(
        "Impossible de lire l'état eFashion (vendeur) — création de nouvelles couleurs ignorée.",
      );
    } else {
      // Choix de la couleur source pour le duplicate : ordre de priorité
      //   1. La main actuelle vue côté eFashion (la plus à jour)
      //   2. La `primaryEfashionProductId` du snapshot précédent
      //   3. La première couleur déjà liée localement (fallback ultime)
      let sourceEfId: number | null = null;
      for (const [efId, live] of liveById) {
        if (live.main) {
          sourceEfId = efId;
          break;
        }
      }
      if (sourceEfId === null && previousSnapshot?.primaryEfashionProductId) {
        sourceEfId = previousSnapshot.primaryEfashionProductId;
      }
      if (sourceEfId === null) {
        const anyLinked = unitColors.find((c) => c.efashionProductId !== null);
        sourceEfId = anyLinked?.efashionProductId ?? null;
      }

      if (sourceEfId === null) {
        createErrors.push(
          "Aucune couleur source connue côté eFashion pour dupliquer — créez d'abord au moins une couleur via publish.",
        );
      } else {
        // Anti-doublon : eFashion refuse 2 couleurs avec le même id_couleur
        // sur le même groupe-produit. On demande la liste existante.
        let usedColorIds = new Set<number>();
        try {
          const { efashionGetAllUsedColorIdsByMainProduct } = await import(
            "@/lib/efashion-api-write"
          );
          const used = await efashionGetAllUsedColorIdsByMainProduct(sourceEfId);
          usedColorIds = new Set(used);
        } catch (err) {
          logger.warn("[eFashion update] allUsedColorIdsByMainProduct KO (anti-doublon désactivé)", {
            productId,
            sourceEfId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        for (const newColor of colorsToCreate) {
          const couleurId = newColor.color!.efashionColorId!;
          const couleurName = newColor.color!.name;
          if (usedColorIds.has(couleurId)) {
            createErrors.push(
              `Couleur « ${couleurName} » déjà utilisée chez eFashion sur ce groupe (id_couleur ${couleurId}) — liaison manuelle requise.`,
            );
            continue;
          }
          try {
            const dup = await efashionDuplicateWithNewColor({
              idProduit: sourceEfId,
              couleurId,
              couleurName,
            });
            const newEfId = dup.id_produit;
            await prisma.productColor.update({
              where: { id: newColor.id },
              data: { efashionProductId: newEfId },
            });
            // Mute la copie en mémoire pour que le filtre `linkedColors` plus bas
            // l'inclue et que le diff la voie comme une variante valide.
            (newColor as { efashionProductId: number | null }).efashionProductId = newEfId;

            // Upload des photos de la nouvelle couleur — 1 photo par appel HTTP
            // pour préserver l'ordre (cf. raisonnement dans la section images
            // plus bas).
            const imgs = newColor.colorId ? (imagesByColorId.get(newColor.colorId) ?? []) : [];
            const sorted = [...imgs].sort((a, b) => a.order - b.order);
            for (let idx = 0; idx < sorted.length; idx++) {
              const img = sorted[idx];
              await efashionUploadProductPhotos(newEfId, [
                {
                  dbPath: img.path,
                  filename: `${product.efashionReferenceBase}-${couleurName}-${idx + 1}.jpg`,
                },
              ]);
            }

            // Publie le brouillon pour que la couleur devienne visible côté
            // catalogue acheteurs (sinon elle reste en `premel='0'` et ne sort
            // jamais en ligne).
            await efashionPublishBrouillon({
              idProduit: newEfId,
              idVendeur: efashionVendorId,
            });

            // Ajoute au liveById pour que le reste du flow le voit comme un
            // variant connu. Les champs `id_collection/id_categorie/...` sont
            // hérités de la source côté eFashion mais on ne les a pas dans la
            // réponse de duplicate — on les remplit avec ceux de la source pour
            // que le payload PUT suivant soit valide.
            const srcLive = liveById.get(sourceEfId);
            liveById.set(newEfId, {
              reference: dup.reference,
              reference_base: product.efashionReferenceBase,
              id_collection: srcLive?.id_collection ?? null,
              id_categorie: srcLive?.id_categorie ?? null,
              id_provenance: srcLive?.id_provenance ?? null,
              id_declinaison: srcLive?.id_declinaison ?? null,
              id_pack: srcLive?.id_pack ?? null,
              vendu_par: srcLive?.vendu_par ?? "couleurs",
              id_vendeur_marque: srcLive?.id_vendeur_marque ?? null,
              main: dup.main,
            });

            colorsCreatedCount++;
            usedColorIds.add(couleurId);
            logger.info("[eFashion update] Nouvelle couleur créée + photos + publish", {
              productId,
              newEfId,
              couleurName,
              photosCount: sorted.length,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            createErrors.push(`createColor(${couleurName}): ${msg}`);
          }
        }
      }
    }
  }

  // Recalcule les colors liées AVEC les nouvelles couleurs qu'on vient de créer.
  const linkedColors = unitColors.filter((c) => c.efashionProductId !== null);
  const unlinkedCount = unitColors.length - linkedColors.length;

  if (linkedColors.length === 0) {
    return {
      success: false,
      error: createErrors.length > 0
        ? createErrors.join(" | ")
        : "Aucune variante à l'unité de ce produit n'est liée à eFashion (les packs ne sont pas synchronisés).",
    };
  }

  // Construit le snapshot cible
  const targetVariants: EfashionVariantSnapshot[] = linkedColors.map((c) => {
    const efashionPrice = computeEfashionPrice({
      basePrice: Number(c.unitPrice),
      isPack: c.saleType === "PACK",
      packQuantity: c.packQuantity,
      markup,
    });
    // `ProductColor.stock` est la source de vérité pour le stock — pareil que
    // ce que fait `lib/ankorstore-publish.ts:getVariantStock`. En UNIT
    // notamment, `variantSizes[0].quantity` est juste un marqueur descriptif
    // (souvent = 1) et n'a aucun rapport avec le vrai stock disponible.
    const totalStock = c.stock;
    const visible = product.status === "ONLINE" && !c.disabled && totalStock > 0;

    // eFashion attend une entrée stock par (couleur, taille). UNIT BJ a au max
    // une taille descriptive, PACK BJ a une taille placeholder ("TU" ou la 1ʳᵉ
    // ligne de pack). Dans les deux cas on pousse `c.stock` sur la taille
    // disponible (ou "TU" en fallback).
    const stockByTaille: Record<string, number> = {};
    const tailleLabel = c.variantSizes[0]?.size.name ?? "TU";
    stockByTaille[tailleLabel] = c.stock;

    const colorImages = c.colorId ? (imagesByColorId.get(c.colorId) ?? []) : [];
    return {
      efashionProductId: c.efashionProductId as number,
      visible,
      prix: efashionPrice,
      poids: c.weight,
      stockByTaille,
      images: colorImages.map((img) => ({ dbPath: img.path, order: img.order })),
    };
  });

  // Descriptions multilingues — pré-remplissage avec les traductions du
  // snapshot précédent (si on en a). Comme ça, si le FR n'a pas changé, le
  // snapshot final repart avec les mêmes traductions et on évite d'appeler
  // /translate inutilement.
  //
  // ⚠️ La description FR envoyée à eFashion inclut le suffix dimensions (même
  // format que PFS) si le produit a au moins une dimension renseignée. Comme
  // ça la fiche eFashion affiche les dimensions en bas de la description.
  const descriptionFr = (product.description ?? "") + buildEfashionDimensionsSuffix(product);
  const prevDescriptions = previousSnapshot?.descriptions;
  const targetDescriptions: EfashionDescriptions = {
    fr: descriptionFr,
    en: prevDescriptions?.en ?? descriptionFr,
    it: prevDescriptions?.it ?? descriptionFr,
    es: prevDescriptions?.es ?? descriptionFr,
    zh: prevDescriptions?.zh ?? descriptionFr,
  };

  // Compositions (matières) — eFashion attend une liste { id_composition,
  // id_composition_localisation, value }. Localisation 4 = "Produit" (observé
  // dans la capture du publish initial). On ignore silencieusement les
  // compositions BJ sans efashionId — la validation de mappage est faite
  // à la publication, pas ici.
  const targetCompositions: EfashionCompositionSnapshot[] = product.compositions
    .filter((pc) => pc.composition.efashionId !== null)
    .map((pc) => ({
      id: pc.composition.efashionId as number,
      localisationId: 4,
      percentage: pc.percentage,
    }));

  // Couleur primaire BJ déterminée par `Product.primaryColorId` (source de
  // vérité) et NON par `ProductColor.isPrimary` qui peut être désynchronisé
  // côté BDD si l'admin a un bug de saisie.
  const bjPrimaryColor =
    (product.primaryColorId
      ? linkedColors.find((c) => c.colorId === product.primaryColorId)
      : undefined) ?? linkedColors.find((c) => c.isPrimary);
  const bjPrimaryEfashionId = bjPrimaryColor?.efashionProductId ?? null;

  const target: EfashionSnapshot = {
    version: 1,
    referenceBase: product.efashionReferenceBase,
    variants: targetVariants,
    descriptions: targetDescriptions,
    compositions: targetCompositions,
    primaryEfashionProductId: bjPrimaryEfashionId,
  };

  const diff = diffEfashionSnapshots(previousSnapshot, target);

  if (!hasAnyChanges(diff)) {
    return { success: true, noChanges: true, unlinkedVariants: unlinkedCount };
  }

  // Applique le diff
  let variantsUpdated = 0;
  let stockMutations = 0;
  let descriptionsUpdatedCount = 0;
  let compositionsUpdatedCount = 0;
  let imagesUpdatedCount = 0;
  let colorsDeletedCount = 0;
  const errors: string[] = [];

  // Champs basiques (visible / prix / poids) — 1 call par variant modifié.
  // ⚠️ Pour qu'un changement de `prix` ne soit pas propagé à toutes les
  // couleurs, on doit envoyer le payload **complet** (cf. HAR de leur UI de
  // mai 2026). Avec un payload minimal `{ id_produit, prix }`, eFashion
  // considère que c'est une modif au niveau « groupe » et écrase le prix
  // de toutes les autres couleurs. On lit donc les valeurs actuelles côté
  // eFashion via listProducts pour récupérer reference, id_declinaison,
  // id_pack et les autres champs « stables », et on les renvoie tels quels.
  //
  // ⚠️ Les variantes dans `diff.added` ne sont traitées comme des updates QUE
  // si elles existent déjà côté eFashion (= apparaissent dans `liveById`). Le
  // filtre est appliqué APRÈS le fetch — voir plus bas. Si une couleur a été
  // ajoutée localement mais qu'eFashion ne la connaît pas (snapshot précédent
  // non null), on skip et on remonte une erreur explicite : eFashion n'a pas
  // d'endpoint propre « ajouter une couleur » (cf.
  // scripts/efashion-test-add-color-via-put.ts pour le diagnostic) — la seule
  // voie sûre est un Rafraîchir complet.
  let variantsToUpdate: Array<{
    variant: EfashionVariantSnapshot;
    fields: ReadonlyArray<"visible" | "prix" | "poids">;
  }> = [
    ...diff.added.map((v) => ({
      variant: v,
      fields: ["visible", "prix", "poids"] as ReadonlyArray<"visible" | "prix" | "poids">,
    })),
    ...diff.changed
      .filter((c) => c.fieldsChanged.length > 0)
      .map((c) => ({
        variant: c.after,
        fields: c.fieldsChanged as ReadonlyArray<"visible" | "prix" | "poids">,
      })),
  ];

  // Fetch live (déjà fait au plus tôt si on a auto-créé des couleurs ; sinon
  // déclenché ici si le diff a besoin du contexte serveur).
  if (variantsToUpdate.length > 0 || diff.primaryChanged || diff.removed.length > 0) {
    await ensureLiveById();
  }

  // Aligne la couleur principale eFashion (`main = true`) sur la primaire BJ.
  // ⚠️ Pas d'endpoint `toggleMainProduct` (la mutation GraphQL qu'on avait
  // n'existe pas vraiment sur le serveur eFashion). Le HAR de leur UI montre
  // qu'ils font 2 appels `updateProduit` séquentiels :
  //   1. ancien main → main:false (avec id_couleur_liee = nouveau main)
  //   2. nouveau main → main:true (avec id_couleur_liee = nouveau main)
  // Le payload contient juste : { id_produit, id_couleur_liee, id_vendeur_marque, prix, prixReduit:null, main }.
  // Important : on fait ça **avant** les updateProduit standards, parce que la
  // couleur `main` propage ses valeurs aux autres couleurs liées — il faut donc
  // d'abord savoir qui est la main pour ordonnancer les updates correctement.
  if (liveById.size > 0) {
    const bjPrimaryEfId = bjPrimaryEfashionId;
    let currentMainEfId: number | null = null;
    for (const [efId, live] of liveById) {
      if (live.main) {
        currentMainEfId = efId;
        break;
      }
    }
    if (bjPrimaryEfId !== null && currentMainEfId !== null && bjPrimaryEfId !== currentMainEfId) {
      try {
        // 1. Désactiver le main actuel.
        const oldLive = liveById.get(currentMainEfId);
        const oldTarget = targetVariants.find((v) => v.efashionProductId === currentMainEfId);
        await efashionUpdateProduit({
          id_produit: currentMainEfId,
          id_couleur_liee: bjPrimaryEfId,
          id_vendeur_marque: oldLive?.id_vendeur_marque ?? 3228,
          prix: oldTarget?.prix ?? 0,
          prixReduit: null,
          main: false,
        });
        // 2. Activer le nouveau main.
        const newLive = liveById.get(bjPrimaryEfId);
        const newTarget = targetVariants.find((v) => v.efashionProductId === bjPrimaryEfId);
        await efashionUpdateProduit({
          id_produit: bjPrimaryEfId,
          id_couleur_liee: bjPrimaryEfId,
          id_vendeur_marque: newLive?.id_vendeur_marque ?? 3228,
          prix: newTarget?.prix ?? 0,
          prixReduit: null,
          main: true,
        });
        // Met à jour notre vue locale.
        if (oldLive) liveById.set(currentMainEfId, { ...oldLive, main: false });
        if (newLive) liveById.set(bjPrimaryEfId, { ...newLive, main: true });
        logger.info("[eFashion update] Couleur principale basculée", {
          productId,
          from: currentMainEfId,
          to: bjPrimaryEfId,
        });

        // La nouvelle main va propager son prix aux autres couleurs lors du
        // prochain updateProduit. Pour garantir que chaque non-main reprenne
        // son propre prix après cette propagation, on enqueue ici toutes les
        // variantes liées (la sort main-first qui suit assure que la main
        // part en premier, puis chaque non-main vient "réécrire" son prix).
        const alreadyQueued = new Set(variantsToUpdate.map((v) => v.variant.efashionProductId));
        for (const tv of targetVariants) {
          if (!alreadyQueued.has(tv.efashionProductId)) {
            variantsToUpdate.push({ variant: tv, fields: ["visible", "prix", "poids"] as const });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`mainSwitch(${currentMainEfId}→${bjPrimaryEfId}): ${msg}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Suppression des couleurs retirées localement (diff.removed)
  // ─────────────────────────────────────────────────────────────────────
  // Si une couleur a été supprimée du produit côté BJ, il faut la retirer
  // aussi côté eFashion sinon elle reste publiée avec ses anciennes photos
  // et son stock. Endpoint : POST /shootings/product/{id}/delete (cf.
  // lib/efashion-shootings.ts:193).
  //
  // Cas piégeux : si la couleur supprimée était la `main` côté eFashion ET
  // que la bascule main plus haut ne l'a pas couverte (typiquement parce
  // que `primaryColorId` BJ pointe encore vers une couleur déjà supprimée
  // ou n'a pas été mis à jour), on force ici une bascule vers la première
  // couleur survivante avant de supprimer — sinon eFashion peut refuser le
  // delete ou se retrouver sans couleur main du groupe.
  let colorsSkippedCount = 0;
  if (diff.removed.length > 0) {
    const removedSet = new Set(diff.removed);
    const currentMainEfId = liveById.size > 0
      ? (Array.from(liveById.entries()).find(([, v]) => v.main)?.[0] ?? null)
      : null;
    const survivor = targetVariants.find((v) => !removedSet.has(v.efashionProductId));

    if (
      currentMainEfId !== null &&
      removedSet.has(currentMainEfId) &&
      survivor &&
      // Si le bloc « bascule main » plus haut a déjà retiré la main de l'ancienne
      // couleur, `liveById.get(currentMainEfId).main` est désormais false → on saute.
      liveById.get(currentMainEfId)?.main === true
    ) {
      try {
        const oldLive = liveById.get(currentMainEfId);
        const survivorLive = liveById.get(survivor.efashionProductId);
        const oldTarget = targetVariants.find((v) => v.efashionProductId === currentMainEfId);
        await efashionUpdateProduit({
          id_produit: currentMainEfId,
          id_couleur_liee: survivor.efashionProductId,
          id_vendeur_marque: oldLive?.id_vendeur_marque ?? 3228,
          prix: oldTarget?.prix ?? survivor.prix,
          prixReduit: null,
          main: false,
        });
        await efashionUpdateProduit({
          id_produit: survivor.efashionProductId,
          id_couleur_liee: survivor.efashionProductId,
          id_vendeur_marque: survivorLive?.id_vendeur_marque ?? 3228,
          prix: survivor.prix,
          prixReduit: null,
          main: true,
        });
        if (oldLive) liveById.set(currentMainEfId, { ...oldLive, main: false });
        if (survivorLive) liveById.set(survivor.efashionProductId, { ...survivorLive, main: true });
        logger.info("[eFashion update] Bascule main forcée avant suppression de l'ancienne main", {
          productId,
          from: currentMainEfId,
          to: survivor.efashionProductId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`mainSwitchBeforeDelete(${currentMainEfId}→${survivor.efashionProductId}): ${msg}`);
      }
    } else if (currentMainEfId !== null && removedSet.has(currentMainEfId) && !survivor) {
      // Aucune couleur survivante : on supprime la main quand même mais on
      // logue un warning — l'utilisatrice est en train de vider le produit.
      logger.warn("[eFashion update] Suppression de la main eFashion sans couleur survivante (groupe vidé)", {
        productId,
        currentMainEfId,
      });
    }

    // Suppression batch via la mutation GraphQL `softDeleteProduits` (vue dans
    // le HAR de leur UI — mai 2026). Plus fiable que
    // `POST /shootings/product/{id}/delete` qui est pensé pour le workflow
    // shooting et peut refuser les produits déjà en ligne.
    try {
      await efashionSoftDeleteProduits(diff.removed);
      colorsDeletedCount = diff.removed.length;
      for (const efId of diff.removed) liveById.delete(efId);
      logger.info("[eFashion update] Couleurs supprimées côté eFashion (softDelete)", {
        productId,
        efIds: diff.removed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`softDeleteProduits(${diff.removed.join(",")}): ${msg}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Filtrage des couleurs ajoutées localement mais inconnues d'eFashion
  // ─────────────────────────────────────────────────────────────────────
  // Si l'utilisatrice ajoute une nouvelle couleur à un produit déjà publié,
  // le diff la place dans `diff.added` avec un `efashionProductId` qu'on a
  // potentiellement renseigné via la modale « Lier ». Mais si elle a juste
  // créé la couleur localement SANS la lier, ou si elle vient juste de la
  // créer et qu'eFashion ne la connaît pas, les updateProduit / stock /
  // photos vont planter (id_produit inconnu).
  //
  // eFashion n'a pas d'endpoint propre « ajouter une couleur à un produit
  // existant » : le seul moyen sûr est un Rafraîchir complet. On filtre donc
  // ici les variantes ajoutées qui n'apparaissent pas dans `liveById` et on
  // remonte une erreur claire qui pointe vers ce Rafraîchir.
  //
  // Exception : pendant l'alignement post-publish (`previousSnapshot === null`,
  // chemin appelé en fin de `efashionPublishProduct` avec forceFullSync),
  // toutes les variantes sont nouvellement créées par `saveMelDraft` et sont
  // dans `liveById` — pas de skip à faire. On reconnaît ce cas au fait que
  // `previousSnapshot` est null (le bloc plus haut a déjà capturé cette
  // valeur dans `previousSnapshot`).
  const skippedAddedEfIds = new Set<number>();
  if (previousSnapshot !== null && liveById.size > 0) {
    for (const added of diff.added) {
      if (!liveById.has(added.efashionProductId)) {
        skippedAddedEfIds.add(added.efashionProductId);
      }
    }
  }
  if (skippedAddedEfIds.size > 0) {
    colorsSkippedCount = skippedAddedEfIds.size;
    errors.push(
      `${skippedAddedEfIds.size} couleur(s) ajoutée(s) localement mais inconnue(s) d'eFashion ` +
        `(id_produit: ${[...skippedAddedEfIds].join(", ")}). ` +
        "Lancez un « Rafraîchir » complet du produit pour les publier proprement.",
    );
    variantsToUpdate = variantsToUpdate.filter(
      (v) => !skippedAddedEfIds.has(v.variant.efashionProductId),
    );
  }

  // ⚠️ Ordre crucial : la couleur eFashion `main=true` propage ses valeurs aux
  // autres couleurs liées. On l'envoie en PREMIER, puis les non-main après
  // (qui restent isolées et conservent leur prix/poids spécifique). Sans cet
  // ordre, un update sur la main APRÈS un non-main écrase le non-main qu'on
  // venait de poser. Découvert via HAR de leur UI (mai 2026).
  variantsToUpdate.sort((a, b) => {
    const aMain = liveById.get(a.variant.efashionProductId)?.main ? 1 : 0;
    const bMain = liveById.get(b.variant.efashionProductId)?.main ? 1 : 0;
    return bMain - aMain; // main (1) avant non-main (0)
  });

  for (const { variant, fields } of variantsToUpdate) {
    try {
      const live = liveById.get(variant.efashionProductId);
      const input: Parameters<typeof efashionUpdateProduit>[0] = {
        id_produit: variant.efashionProductId,
      };
      // Recopie des champs « stables » lus chez eFashion — sans ça, eFashion
      // propage prix/poids/visible à toutes les couleurs.
      if (live) {
        input.reference = live.reference;
        if (live.reference_base) input.reference_base = live.reference_base;
        if (live.id_collection !== null) input.id_collection = live.id_collection;
        if (live.id_categorie !== null) input.id_categorie = live.id_categorie;
        if (live.id_provenance !== null) input.id_provenance = live.id_provenance;
        if (live.id_declinaison !== null) input.id_declinaison = live.id_declinaison;
        if (live.id_pack !== null) input.id_pack = live.id_pack;
        if (live.vendu_par === "couleurs" || live.vendu_par === "tailles") {
          input.vendu_par = live.vendu_par;
        }
        if (live.id_vendeur_marque !== null) input.id_vendeur_marque = live.id_vendeur_marque;
        input.prixReduit = null;
      }
      // Champs qu'on veut effectivement modifier.
      if (fields.includes("visible")) input.visible = variant.visible;
      if (fields.includes("prix")) input.prix = variant.prix;
      if (fields.includes("poids")) input.poids = variant.poids;

      await efashionUpdateProduit(input);
      variantsUpdated++;
      logger.info("[eFashion update] updateProduit OK", {
        efId: variant.efashionProductId,
        prix: input.prix,
        poids: input.poids,
        visible: input.visible,
        fullPayload: !!live,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`updateProduit(${variant.efashionProductId}): ${msg}`);
    }
  }

  // Stock — batch par variant. On utilise `id_couleur` qu'on retrouve via le mapping
  // local : pour chaque efashionProductId, on retrouve sa Color.efashionColorId.
  const efIdToColorId = new Map<number, number | null>();
  const colorRows = await prisma.color.findMany({
    where: {
      id: { in: linkedColors.map((c) => c.colorId).filter(Boolean) as string[] },
    },
    select: { id: true, efashionColorId: true },
  });
  const localColorIdToEfashion = new Map(colorRows.map((c) => [c.id, c.efashionColorId]));
  for (const lc of linkedColors) {
    if (lc.colorId && lc.efashionProductId) {
      efIdToColorId.set(lc.efashionProductId, localColorIdToEfashion.get(lc.colorId) ?? null);
    }
  }

  const stockItemsByEfId = new Map<
    number,
    Array<{ id_couleur: number; value: number; taille: string | null }>
  >();
  for (const v of [...diff.added, ...diff.changed.map((c) => c.after)]) {
    // Skip les couleurs ajoutées qu'eFashion ne connaît pas (voir bloc de
    // filtrage plus haut) — on ne peut pas pousser de stock vers un produit
    // qui n'existe pas côté eFashion.
    if (skippedAddedEfIds.has(v.efashionProductId)) continue;
    const idCouleur = efIdToColorId.get(v.efashionProductId);
    if (!idCouleur) continue; // on ne peut pas pousser le stock sans id_couleur eFashion
    const arr: Array<{ id_couleur: number; value: number; taille: string | null }> = [];
    for (const [taille, value] of Object.entries(v.stockByTaille)) {
      arr.push({ id_couleur: idCouleur, value, taille: taille === "TU" ? null : taille });
    }
    if (arr.length > 0) stockItemsByEfId.set(v.efashionProductId, arr);
  }

  for (const [efId, items] of stockItemsByEfId) {
    try {
      await efashionSaveProduitStocks({ id_produit: efId, items });
      stockMutations++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`saveProduitStocks(${efId}): ${msg}`);
    }
  }

  // Descriptions multilingues — toutes les couleurs d'un même produit BJ
  // partagent la même description, mais côté eFashion chaque couleur est un
  // `id_produit` distinct, donc on doit appeler `saveProduitDescription` une
  // fois par variante liée. Convention eFashion : `texte_uk` = anglais.
  //
  // On traduit via le moteur eFashion (POST /translate) plutôt que via DeepL
  // local : c'est le même comportement que leur back-office quand un commercial
  // clique sur l'icône de traduction. Pas de quota DeepL consommé côté BJ.
  if (diff.descriptionsChanged) {
    logger.info("[eFashion] Description FR a changé, traduction + push", {
      productId,
      linkedColors: linkedColors.length,
      frChanged: previousSnapshot?.descriptions?.fr !== descriptionFr,
    });

    if (descriptionFr.trim().length > 0) {
      try {
        const translated = await efashionTranslateText({ text: descriptionFr });
        targetDescriptions.en = translated.en;
        targetDescriptions.it = translated.it;
        targetDescriptions.es = translated.es;
        targetDescriptions.zh = translated.zh;
      } catch (err) {
        // Si eFashion refuse la traduction, on continue avec FR partout
        // plutôt que d'abandonner la sync — au pire la fiche eFashion aura
        // le texte FR dans toutes les langues, ce qui est récupérable.
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("[eFashion] /translate failed, fallback to FR everywhere", {
          productId,
          error: msg,
        });
      }
    }

    for (const lc of linkedColors) {
      const efId = lc.efashionProductId;
      if (!efId) continue;
      try {
        await efashionSaveProduitDescription({
          id_produit: efId,
          texte_fr: targetDescriptions.fr,
          texte_uk: targetDescriptions.en,
          texte_it: targetDescriptions.it,
          texte_es: targetDescriptions.es,
          texte_zh: targetDescriptions.zh,
        });
        descriptionsUpdatedCount++;
        logger.info("[eFashion] saveProduitDescription OK", {
          efId,
          enSample: targetDescriptions.en.slice(0, 60),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`saveProduitDescription(${efId}): ${msg}`);
      }
    }
  } else {
    logger.info("[eFashion] Description inchangée, skip /translate", { productId });
  }

  // Compositions (matières) — comme pour la description, eFashion attend un
  // appel par `id_produit` (= par couleur). `saveProduitCompositions` remplace
  // la liste complète côté eux, donc pas besoin de diff fin item par item.
  if (diff.compositionsChanged) {
    logger.info("[eFashion] Compositions modifiées, push", {
      productId,
      count: targetCompositions.length,
    });
    for (const lc of linkedColors) {
      const efId = lc.efashionProductId;
      if (!efId) continue;
      try {
        await efashionSaveProduitCompositions({
          id_produit: efId,
          items: targetCompositions.map((c) => ({
            id_composition: c.id,
            id_composition_localisation: c.localisationId,
            value: c.percentage,
          })),
        });
        compositionsUpdatedCount++;
        logger.info("[eFashion] saveProduitCompositions OK", { efId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`saveProduitCompositions(${efId}): ${msg}`);
      }
    }
  } else {
    logger.info("[eFashion] Compositions inchangées, skip", { productId });
  }

  // Photos — eFashion stocke les images par `id_produit` (= par couleur),
  // pareil que la description et les compositions. Stratégie : pour chaque
  // variante avec un changement d'images détecté par le diff, on purge la
  // liste eFashion actuelle (GET + DELETE filename par filename) et on
  // ré-upload les images BJ dans l'ordre. C'est moins fin qu'un patch ciblé
  // mais ça garantit la cohérence et le réordonnancement (eFashion renomme
  // automatiquement après chaque DELETE, donc on ne peut pas se reposer
  // sur les positions intermédiaires).
  //
  // Cas couverts :
  //   - `forceFullSync` : on resync les photos de toutes les variantes liées,
  //     que les images aient changé ou non dans le snapshot.
  //   - Variantes ajoutées (`diff.added`) : on upload directement leurs photos
  //     (eFashion vient de leur être lié, pas de photos préalables à purger).
  //   - Variantes modifiées (`diff.changed`) avec `imagesChanged=true` : purge + ré-upload.
  const variantsNeedingImageSync: EfashionVariantSnapshot[] = [];
  if (opts.forceFullSync) {
    variantsNeedingImageSync.push(...targetVariants.filter((v) => v.images && v.images.length > 0));
  } else {
    for (const a of diff.added) {
      // Skip les couleurs ajoutées inconnues d'eFashion (cf. bloc de filtrage
      // plus haut) — pas la peine d'uploader des photos sur un id_produit
      // inexistant : l'API renverrait une erreur.
      if (skippedAddedEfIds.has(a.efashionProductId)) continue;
      if (a.images && a.images.length > 0) variantsNeedingImageSync.push(a);
    }
    for (const c of diff.changed) {
      if (c.imagesChanged && c.after.images && c.after.images.length > 0) {
        variantsNeedingImageSync.push(c.after);
      }
    }
  }

  if (variantsNeedingImageSync.length > 0) {
    logger.info("[eFashion] Photos à resynchroniser", {
      productId,
      variantsCount: variantsNeedingImageSync.length,
      force: !!opts.forceFullSync,
    });

    const productRefBase = product.efashionReferenceBase;
    for (const variant of variantsNeedingImageSync) {
      const efId = variant.efashionProductId;
      const images = variant.images ?? [];
      try {
        // 1. Purge des photos existantes côté eFashion.
        // ⚠️ eFashion renumérote automatiquement les filenames après chaque
        // DELETE (cf. docs/efashion-api.md §18.3) : supprimer `c.jpg` fait que
        // `z-1.jpg` devient le nouveau `c.jpg`. On ne peut donc PAS itérer
        // sur la liste initiale — il faut re-fetcher la liste après chaque
        // suppression et toujours supprimer la 1ʳᵉ entrée. Une garde anti
        // boucle infinie est en place au cas où eFashion renvoie toujours
        // la même photo (bug serveur improbable mais on veut couper court).
        let safety = 50;
        // Boucle tant qu'eFashion expose encore des photos pour ce produit.
        while (safety-- > 0) {
          const current = await efashionGetProductPhotos(efId);
          if (current.photos.length === 0) break;
          const photoPath = current.photos[0];
          const filename = photoPath.split("/").pop();
          if (!filename) break;
          try {
            await efashionDeleteProductPhoto({ efashionProductId: efId, filename });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn("[eFashion] deletePhoto échoué (abandon purge)", { efId, filename, error: msg });
            break; // on arrête la purge pour éviter une boucle infinie sur la même photo
          }
        }

        // 2. Ré-upload dans l'ordre `order` croissant. La 1ʳᵉ photo uploadée
        // devient `c.jpg` (principale), les suivantes `z-1.jpg`, `z-2.jpg`, etc.
        //
        // ⚠️ Upload **séquentiel** (1 photo = 1 requête HTTP) et PAS en batch :
        // un upload multipart avec plusieurs `photos` peut être traité dans un
        // ordre indéterminé côté eFashion → une photo censée être 2ᵉ peut
        // finir en principale. En sérialisant, eFashion les enregistre dans
        // l'ordre exact où on les pousse.
        const sorted = [...images].sort((a, b) => a.order - b.order);
        const localColor = linkedColors.find((c) => c.efashionProductId === efId);
        const colorName = localColor?.colorId ? `color-${localColor.colorId}` : "color";
        for (let idx = 0; idx < sorted.length; idx++) {
          const img = sorted[idx];
          await efashionUploadProductPhotos(efId, [
            {
              dbPath: img.dbPath,
              filename: `${productRefBase}-${colorName}-${idx + 1}.jpg`,
            },
          ]);
        }
        imagesUpdatedCount++;
        logger.info("[eFashion] Photos resynchronisées", {
          efId,
          count: sorted.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`syncPhotos(${efId}): ${msg}`);
      }
    }
  } else {
    logger.info("[eFashion] Photos inchangées, skip", { productId });
  }

  // Cumule les erreurs de la phase auto-création avec le reste.
  if (createErrors.length > 0) errors.push(...createErrors);

  // Sauve le nouveau snapshot uniquement si on n'a pas d'erreur (sinon on
  // garderait un état faux dans la BDD et on rate les retries).
  if (errors.length === 0) {
    await prisma.product.update({
      where: { id: productId },
      data: {
        efashionLastSyncSnapshot: target as unknown as Prisma.InputJsonValue,
        efashionLastRefreshedAt: new Date(),
      },
    });
  } else {
    logger.warn("[eFashion] update finished with errors", {
      productId,
      errors,
    });
  }

  return {
    success: errors.length === 0,
    error: errors.length > 0 ? errors.join(" | ") : undefined,
    variantsUpdated,
    stockMutationsCount: stockMutations,
    descriptionsUpdatedCount,
    compositionsUpdatedCount,
    imagesUpdatedCount,
    colorsDeletedCount,
    colorsCreatedCount,
    colorsSkippedCount,
    unlinkedVariants: unlinkedCount,
  };
}

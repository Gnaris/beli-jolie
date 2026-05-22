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
} from "@/lib/efashion-api-write";
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
      efashionReferenceBase: true,
      efashionLastSyncSnapshot: true,
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
        },
      },
    },
  });
  if (!product) return { success: false, error: "Produit introuvable" };
  if (!product.efashionReferenceBase) {
    return { success: false, error: "Produit non lié à eFashion (référence manquante)" };
  }

  const markup = await loadEfashionMarkup();

  // eFashion ne synchronise que les variantes UNIT. Une variante PACK qui
  // posséderait un efashionProductId (cas legacy avant le script de migration)
  // est explicitement ignorée ici.
  const unitColors = product.colors.filter((c) => c.saleType === "UNIT");
  const linkedColors = unitColors.filter((c) => c.efashionProductId !== null);
  const unlinkedCount = unitColors.length - linkedColors.length;

  if (linkedColors.length === 0) {
    return {
      success: false,
      error:
        "Aucune variante à l'unité de ce produit n'est liée à eFashion (les packs ne sont pas synchronisés).",
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

    return {
      efashionProductId: c.efashionProductId as number,
      visible,
      prix: efashionPrice,
      poids: c.weight,
      stockByTaille,
    };
  });

  // Descriptions multilingues — pré-remplissage avec les traductions du
  // snapshot précédent (si on en a). Comme ça, si le FR n'a pas changé, le
  // snapshot final repart avec les mêmes traductions et on évite d'appeler
  // /translate inutilement.
  const descriptionFr = product.description ?? "";
  const previousSnapshot = opts.forceFullSync
    ? null
    : (product.efashionLastSyncSnapshot as EfashionSnapshot | null);
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

  const bjPrimaryColor = linkedColors.find((c) => c.isPrimary);
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
  const errors: string[] = [];

  // Champs basiques (visible / prix / poids) — 1 call par variant modifié.
  // ⚠️ Pour qu'un changement de `prix` ne soit pas propagé à toutes les
  // couleurs, on doit envoyer le payload **complet** (cf. HAR de leur UI de
  // mai 2026). Avec un payload minimal `{ id_produit, prix }`, eFashion
  // considère que c'est une modif au niveau « groupe » et écrase le prix
  // de toutes les autres couleurs. On lit donc les valeurs actuelles côté
  // eFashion via listProducts pour récupérer reference, id_declinaison,
  // id_pack et les autres champs « stables », et on les renvoie tels quels.
  const variantsToUpdate = [
    ...diff.added.map((v) => ({ variant: v, fields: ["visible", "prix", "poids"] as const })),
    ...diff.changed
      .filter((c) => c.fieldsChanged.length > 0)
      .map((c) => ({ variant: c.after, fields: c.fieldsChanged })),
  ];

  let liveById = new Map<number, { reference: string; reference_base: string | null; id_collection: number | null; id_categorie: number | null; id_provenance: number | null; id_declinaison: number | null; id_pack: number | null; vendu_par: string | null; id_vendeur_marque: number | null; main: boolean }>();
  if (variantsToUpdate.length > 0 || diff.primaryChanged) {
    try {
      const { efashionGetMe, efashionListProducts } = await import("@/lib/efashion-api");
      const me = await efashionGetMe();
      const list = await efashionListProducts({
        idVendeur: me.id_vendeur,
        take: 100,
        reference: product.efashionReferenceBase,
        premelFilter: "en_ligne",
      });
      for (const it of list.items) {
        // On garde uniquement ceux qui correspondent strictement à notre
        // reference_base (le filtre eFashion étant partiel).
        if (
          (it.reference_base ?? "").toLowerCase().trim() !==
          product.efashionReferenceBase.toLowerCase().trim()
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
      // Si le listProducts plante, on continue avec un payload minimal.
      // Risque : le prix sera propagé sur toutes les couleurs. Mais on préfère
      // tenter quelque chose plutôt que d'abandonner toute la sync.
      logger.warn("[eFashion update] Lecture live eFashion KO, payload réduit", {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
      liveById = new Map();
    }
  }

  // Aligne la couleur principale eFashion (`main = true`) sur la primaire BJ
  // (`isPrimary = true`). Si elles diffèrent, on bascule via `toggleMainProduct`.
  // Important : on fait ça **avant** la sortie des updateProduit, parce que la
  // couleur `main` propage ses valeurs aux autres couleurs liées — il faut donc
  // d'abord savoir qui est la main pour ordonnancer les updates correctement.
  if (liveById.size > 0) {
    const bjPrimary = linkedColors.find((c) => c.isPrimary);
    const bjPrimaryEfId = bjPrimary?.efashionProductId ?? null;
    let currentMainEfId: number | null = null;
    for (const [efId, live] of liveById) {
      if (live.main) {
        currentMainEfId = efId;
        break;
      }
    }
    if (bjPrimaryEfId !== null && currentMainEfId !== null && bjPrimaryEfId !== currentMainEfId) {
      try {
        await efashionToggleMainProduct(bjPrimaryEfId);
        // Met à jour notre vue locale : la nouvelle main est bjPrimaryEfId,
        // l'ancienne (currentMainEfId) devient non-main.
        const oldMain = liveById.get(currentMainEfId);
        if (oldMain) liveById.set(currentMainEfId, { ...oldMain, main: false });
        const newMain = liveById.get(bjPrimaryEfId);
        if (newMain) liveById.set(bjPrimaryEfId, { ...newMain, main: true });
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
        errors.push(`toggleMainProduct(${bjPrimaryEfId}): ${msg}`);
      }
    }
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
    unlinkedVariants: unlinkedCount,
  };
}

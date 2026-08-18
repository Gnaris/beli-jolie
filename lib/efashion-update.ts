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
  efashionUpsertProduitStock,
  efashionSaveProduitDescription,
  efashionSaveProduitCompositions,
  efashionTranslateText,
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
import { resolveEfashionDeclinaison } from "@/lib/efashion-declinaison-matcher";

interface UpdateOpts {
  /** Si true, ignore le snapshot existant et renvoie tout — équivalent du « Resync » côté UI. */
  forceFullSync?: boolean;
  /**
   * Mis à `true` uniquement par `efashionPublishProduct` quand il appelle cette
   * fonction en fin de publish pour aligner les attributs par couleur. Dans ce
   * cas-là, toutes les variantes viennent d'être créées par `saveMelDraft` et
   * sont garanties d'être dans `liveById` — on désactive donc le filet de
   * sécurité « numéro inconnu d'eFashion ». Dans tous les autres cas (sync
   * incrémentale OU resync forcée via UI), ce flag reste `false` pour que le
   * filet rattrape les `efashionProductId` orphelins (ex : couleur soft-delete
   * côté eFashion sans nettoyage local — cf. cas W124/Fuchsia juin 2026).
   */
  isPostPublishAlignment?: boolean;
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
  /**
   * Nombre de couleurs dont l'`id_declinaison` (moule de tailles eFashion) a
   * été basculé pendant ce cycle. > 0 quand l'utilisatrice a ajouté/retiré
   * une taille au produit BJ.
   */
  declinaisonUpdatedCount?: number;
  noChanges?: boolean;
}

/**
 * Filet de sécurité « couleur ajoutée localement mais inconnue d'eFashion ».
 *
 * Contexte : eFashion n'a pas d'endpoint « ajouter une couleur » sur un produit
 * existant. Si l'utilisatrice relie manuellement un `ProductColor` à un
 * `id_produit` eFashion inexistant/supprimé, aucune erreur ne remonte à
 * l'appel : les push suivants (stock, description) répondent `200` mais ne
 * stockent rien. On tag alors la variante orpheline pour skipper les push et
 * remonter une erreur claire qui pointe vers un « Rafraîchir » complet.
 *
 * ⚠️ IMPORTANT — filtrage anti-faux-positif :
 * En mode `forceFullSync=true` (bouton « Rafraîchir »), le diff met TOUTES
 * les variantes dans `added` (parce que `prev=null`). Sans filtrage, on
 * marquerait comme « orpheline » toute variante qui n'apparaît pas dans le
 * listing eFashion — y compris les variantes qu'on a nous-mêmes cachées en
 * poussant `visible=false` (couleur locale `disabled=true`). eFashion les
 * exclut alors de son listing groupe (même filtre `premelFilter: "tous"`),
 * ce qui déclenchait le faux positif « Écru inconnue » sur la référence
 * 92952 issyma le 26/07/2026.
 *
 * Correctif : on ignore les variantes déjà connues du snapshot RÉEL (pas
 * celui forcé à null par `forceFullSync`). Le filet cible uniquement les
 * VRAIES nouvelles variantes.
 */
export function computeOrphanEfashionIds(
  addedVariants: readonly { efashionProductId: number }[],
  liveEfIds: ReadonlySet<number>,
  realPrevSnapshotVariants: readonly { efashionProductId: number }[] | null,
): Set<number> {
  const orphans = new Set<number>();
  const knownFromPrevSnapshot = new Set(
    (realPrevSnapshotVariants ?? []).map((v) => v.efashionProductId),
  );
  for (const added of addedVariants) {
    // Ancienne variante (déjà présente dans le snapshot RÉEL) → pas d'alerte.
    // Elle peut être absente du listing eFashion parce qu'on a poussé
    // visible=false auparavant (couleur locale désactivée) : légitime,
    // pas d'action requise, pas de warning à faire remonter.
    if (knownFromPrevSnapshot.has(added.efashionProductId)) continue;
    if (!liveEfIds.has(added.efashionProductId)) {
      orphans.add(added.efashionProductId);
    }
  }
  return orphans;
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
      // Catégorie BJ — mappée à un id_categorie eFashion (arbre 3 niveaux).
      // Source de vérité pour la sync : quand elle change, on doit propager
      // à TOUTES les couleurs (eFashion stocke la catégorie par variante).
      category: { select: { efashionCategorieId: true } },
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
          efashionColorIdOverride: true,
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
  // Snapshot RÉEL (toujours celui persisté en BDD). Sert au filet de sécurité
  // « couleur inconnue d'eFashion » pour distinguer une nouvelle variante
  // (jamais synchronisée) d'une variante ancienne. En `forceFullSync`, on
  // passe `null` au diff pour tout re-pousser, mais le filet doit garder la
  // vraie mémoire pour ne pas paniquer sur les anciennes variantes.
  const realPrevSnapshot =
    (product.efashionLastSyncSnapshot as EfashionSnapshot | null) ?? null;
  const previousSnapshot = opts.forceFullSync ? null : realPrevSnapshot;

  // eFashion ne synchronise que les variantes UNIT. Une variante PACK qui
  // posséderait un efashionProductId (cas legacy avant le script de migration)
  // est explicitement ignorée ici.
  //
  // ⚠️ On NE filtre PAS ici les variantes sans image. Si une variante déjà
  // liée à eFashion (efashionProductId !== null) perd temporairement ses
  // images locales (job image en attente, ré-upload en cours…), elle DOIT
  // rester dans `linkedColors` — sinon le diff la place dans `removed` et
  // déclenche un softDelete agressif chez eFashion (cas W124/Fuchsia
  // 10-25/06/2026 : couleur supprimée par notre code à cause d'un état
  // images transitoire, puis numéro eFashion orphelin laissé en BDD locale).
  // Le filtre sur les images n'est appliqué qu'au moment de l'auto-création
  // d'une nouvelle couleur (`colorsToCreate` plus bas).
  const colorIdsHavingImages = new Set(imagesByColorId.keys());
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
    /** id_couleur eFashion de cette variante (= mapping de la couleur BJ). */
    id_couleur: number | null;
    main: boolean;
    /** État `visible` actuel côté eFashion — sert à détecter les dérives silencieuses. */
    visible: boolean;
    /**
     * Statut catalogue acheteurs eFashion :
     *   - `"0"` = en ligne
     *   - `"1"` = brouillon (créé mais pas publié — le heal step le rattrape)
     *   - `null` = non fetched / inconnu (variante fraîchement créée in-memory)
     */
    premel: string | null;
  };
  let liveById = new Map<number, LiveItem>();
  let efashionVendorId: number | null = null;
  let liveFetched = false;
  async function ensureLiveById(): Promise<void> {
    if (liveFetched) return;
    liveFetched = true;
    try {
      const { efashionGetMe, efashionListByReferenceBaseExact } = await import(
        "@/lib/efashion-api"
      );
      const me = await efashionGetMe();
      efashionVendorId = me.id_vendeur;
      // ⚠️ Pagination obligatoire — voir lib/efashion-api.ts pour le détail.
      // `reference: "A11"` côté eFashion remonte aussi A1100, A1134, A1161…
      // et trie par dateCreation DESC, donc les fiches historiques sortent en
      // dernier. Sans pagination, on ratait les liens existants → liveById vide
      // → bascule main + payload complet sautés + propagation de visible:false
      // aux autres couleurs du groupe.
      const items = await efashionListByReferenceBaseExact({
        idVendeur: me.id_vendeur,
        referenceBase: product!.efashionReferenceBase!,
        // « tous » plutôt que « en_ligne » : on a besoin de voir aussi les
        // couleurs en brouillon pour pouvoir auto-lier une couleur locale qui
        // existe déjà côté eFashion mais n'a pas encore été publiée.
        premelFilter: "tous",
      });
      for (const it of items) {
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
          id_couleur: it.id_couleur ?? null,
          main: it.main === true,
          visible: it.visible === true,
          premel: it.premel ?? null,
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
  //   - une couleur source côté eFashion (main + référence) connue
  // Les couleurs `disabled=true` sont créées quand même : le push
  // `updateProduit` qui suit posera `visible=false` (calcul plus bas
  // ligne ~698 : `!c.disabled` dans `visible`) — la couleur existe chez
  // eFashion mais reste invisible côté catalogue acheteurs jusqu'à ce
  // qu'elle soit réactivée côté boutique.
  let colorsCreatedCount = 0;
  const createErrors: string[] = [];
  const colorsToCreate = unitColors.filter(
    (c) =>
      c.efashionProductId === null &&
      // Mapping effectif = override secondaire s'il existe, sinon principal.
      (c.efashionColorIdOverride ?? c.color?.efashionColorId ?? null) != null &&
      // Pas de création sans image locale — sinon la couleur arrive vide
      // chez eFashion (observé W124/Fuchsia 10/06/2026 : publish avec
      // photosCount:0 → fiche jamais visible côté acheteurs).
      c.colorId !== null &&
      colorIdsHavingImages.has(c.colorId),
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
          // Override eFashion prioritaire sur le mapping principal Color.efashionColorId.
          const couleurId = (newColor.efashionColorIdOverride ?? newColor.color!.efashionColorId!) as number;
          const couleurName = newColor.color!.name;
          if (usedColorIds.has(couleurId)) {
            // Cas typique : l'admin a supprimé puis re-ajouté la couleur dans
            // le formulaire avant d'enregistrer. Côté eFashion, l'ancienne
            // ligne existe toujours (créée lors d'un publish précédent). On
            // l'auto-relie au lieu de bloquer la sync — si on retrouve son
            // id_produit dans `liveById`, on le pose sur la ProductColor.
            let existingEfId: number | null = null;
            for (const [efId, live] of liveById) {
              if (live.id_couleur === couleurId) {
                existingEfId = efId;
                break;
              }
            }
            if (existingEfId !== null) {
              await prisma.productColor.update({
                where: { id: newColor.id },
                data: { efashionProductId: existingEfId },
              });
              (newColor as { efashionProductId: number | null }).efashionProductId =
                existingEfId;
              logger.info("[eFashion update] Auto-liaison d'une couleur déjà connue d'eFashion", {
                productId,
                couleurName,
                couleurId,
                reusedEfId: existingEfId,
              });
              continue;
            }
            // Pas trouvé d'id_produit pour cet id_couleur (typiquement la
            // couleur existe côté eFashion mais hors du périmètre de
            // listProducts) — on remonte l'erreur pour que l'admin lie à la
            // main grâce à la modale dédiée.
            createErrors.push(
              `Couleur « ${couleurName} » déjà utilisée chez eFashion sur ce groupe (id_couleur ${couleurId}) — liaison manuelle requise.`,
            );
            continue;
          }
          try {
            // ⚠️ Méthode officielle eFashion = séquence exacte du bouton
            // « + Ajouter une couleur » de leur UI vendeur (HAR 29/06/2026) :
            //   1. duplicateWithNewColor → crée la ligne rattachée au groupe
            //      (même reference_base, id_couleur_liee = main)
            //   2. POST /api/upload-product-photo → 1 appel par photo (ordre
            //      préservé)
            //   3. publishBrouillon → met la fiche en ligne côté acheteurs
            //
            // ⚠️ Ne PAS utiliser PUT /shootings/product/{mainId} : eFashion
            // verrouille le shooting d'origine une fois confirmé (HTTP 400
            // « Ce shooting est déjà confirmé et ne peut plus être modifié »).
            // C'est ce qui bloquait l'ajout de Noir/Turquoise sur W122 en
            // juin 2026. La séquence duplicate→upload→publish marche que le
            // shooting du groupe soit confirmé ou pas.
            const srcLive = liveById.get(sourceEfId);

            const { efashionDuplicateWithNewColor, efashionPublishBrouillon } =
              await import("@/lib/efashion-api-write");
            const dup = await efashionDuplicateWithNewColor({
              idProduit: sourceEfId,
              couleurId,
              couleurName,
            });
            const newEfId = dup.id_produit;

            // Lie immédiatement en BDD locale — si l'upload/publish plante
            // après, la prochaine sync verra la couleur déjà liée et passera
            // l'étape duplicate (sinon on créerait un doublon chez eFashion).
            await prisma.productColor.update({
              where: { id: newColor.id },
              data: { efashionProductId: newEfId },
            });
            (newColor as { efashionProductId: number | null }).efashionProductId =
              newEfId;

            // Upload des photos : 1 par appel HTTP (préserve l'ordre — cf.
            // commentaires dans efashion-photos.ts). publishBrouillon exige
            // au moins une photo, et `colorsToCreate` filtre déjà sur la
            // présence d'images locales en amont.
            const imgs = newColor.colorId
              ? (imagesByColorId.get(newColor.colorId) ?? [])
              : [];
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

            // Mise en ligne — sort la fiche du mode brouillon, la rend visible
            // côté catalogue acheteurs. Les attributs (prix, stock, visible…)
            // spécifiques à cette couleur sont alignés par la suite du flow
            // via efashionUpdateProduit/saveProduitStocks.
            try {
              await efashionPublishBrouillon({
                idProduit: newEfId,
                idVendeur: efashionVendorId,
              });
            } catch (err) {
              logger.warn(
                "[eFashion update] publishBrouillon a planté (non bloquant — la fiche reste en brouillon)",
                {
                  productId,
                  newEfId,
                  couleurName,
                  error: err instanceof Error ? err.message : String(err),
                },
              );
            }

            // Ajoute au liveById pour que le reste du flow voie la nouvelle
            // variante. duplicateWithNewColor ne retourne pas les attributs
            // de catégorie/collection/etc. — on les hérite de srcLive (la
            // couleur source), c'est le contrat d'eFashion : la nouvelle
            // couleur clone l'intégralité du parent.
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
              id_couleur: couleurId,
              main: dup.main === true,
              // Nouvelle couleur fraîchement dupliquée : eFashion la crée
              // toujours en `visible=false` (attendu — sera basculée par le
              // updateProduit final si target.visible=true).
              visible: false,
              // publishBrouillon a soit réussi (=> "0"), soit throw et été
              // catché en warn — dans le doute on laisse null. Le heal step
              // en aval ignore les null pour ne pas re-publier à tort.
              premel: null,
            });

            colorsCreatedCount++;
            usedColorIds.add(couleurId);
            logger.info(
              "[eFashion update] Nouvelle couleur ajoutée via duplicateWithNewColor (dans le groupe)",
              {
                productId,
                sourceEfId,
                newEfId,
                couleurName,
                couleurId,
                photosCount: sorted.length,
              },
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            createErrors.push(`addColor(${couleurName}): ${msg}`);
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Heal : rattrapage des couleurs coincées en brouillon côté eFashion
  // ─────────────────────────────────────────────────────────────────────
  // Cas typique (vécu A2098A/Vert le 2026-07-17) : lors d'un ancien sync,
  // `duplicateWithNewColor` a réussi (efashionProductId posé sur la ProductColor)
  // mais l'upload photo a raté sur ENOENT (race avec le worker d'images) →
  // exception → `publishBrouillon` sauté → la fiche reste en `premel="1"`
  // pour toujours. Les syncs suivants ignorent le bloc addColor car la
  // couleur est « déjà liée » et ne rappellent jamais publishBrouillon.
  // Résultat : la couleur est invisible côté catalogue acheteurs.
  //
  // On rattrape ici : on fetch l'état eFashion si pas déjà fait, on repère
  // les couleurs liées encore en `premel="1"` et on appelle
  // `publishBrouillonBulk` dessus. Non bloquant.
  const linkedForHeal = unitColors.filter((c) => c.efashionProductId !== null);
  if (linkedForHeal.length > 0) {
    await ensureLiveById();
    if (liveById.size > 0 && efashionVendorId !== null) {
      const stuckIds: number[] = [];
      for (const c of linkedForHeal) {
        const live = liveById.get(c.efashionProductId!);
        if (live?.premel === "1") stuckIds.push(c.efashionProductId!);
      }
      if (stuckIds.length > 0) {
        try {
          const { efashionPublishBrouillonBulk } = await import(
            "@/lib/efashion-api-write"
          );
          const publishedCount = await efashionPublishBrouillonBulk({
            idProduits: stuckIds,
            idVendeur: efashionVendorId,
          });
          logger.info(
            "[eFashion update] Brouillons oubliés rattrapés (heal publishBrouillonBulk)",
            { productId, stuckIds, publishedCount },
          );
          // Reflète le nouveau statut dans liveById pour la suite du flow.
          for (const id of stuckIds) {
            const live = liveById.get(id);
            if (live) liveById.set(id, { ...live, premel: "0" });
          }
        } catch (err) {
          logger.warn(
            "[eFashion update] Heal publishBrouillonBulk a planté (non bloquant)",
            {
              productId,
              stuckIds,
              error: err instanceof Error ? err.message : String(err),
            },
          );
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
    // Fallback : si les images locales ont temporairement disparu mais que la
    // variante est déjà liée et que le snapshot précédent en avait, on conserve
    // les images du snapshot — sinon le diff verrait `imagesChanged=true` et
    // déclencherait un push qui poserait `images: []` côté eFashion (= suppression
    // des photos chez eux pour un état local transitoire). Voir le commentaire
    // sur `unitColors` plus haut pour le contexte.
    let imagesForSnapshot: Array<{ dbPath: string; order: number }> = colorImages.map(
      (img) => ({ dbPath: img.path, order: img.order }),
    );
    if (imagesForSnapshot.length === 0 && previousSnapshot) {
      const prevVariant = previousSnapshot.variants.find(
        (v) => v.efashionProductId === c.efashionProductId,
      );
      if (prevVariant?.images && prevVariant.images.length > 0) {
        imagesForSnapshot = prevVariant.images.map((img) => ({
          dbPath: img.dbPath,
          order: img.order,
        }));
      }
    }
    return {
      efashionProductId: c.efashionProductId as number,
      visible,
      prix: efashionPrice,
      poids: c.weight,
      stockByTaille,
      images: imagesForSnapshot,
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

  // ─────────────────────────────────────────────────────────────────────
  // Déclinaison cible (« moule de tailles » côté eFashion).
  // ─────────────────────────────────────────────────────────────────────
  // Si l'utilisatrice a ajouté/retiré une taille au produit BJ (ex : passe de
  // « Taille unique » à « TU + XL »), il faut basculer le groupe vers une
  // déclinaison eFashion qui couvre les nouvelles tailles. Sinon les stocks
  // pour la nouvelle taille tombent dans le vide côté eFashion.
  //
  // On compare les SETS de tailles entre le snapshot précédent et l'état
  // actuel. Si pas de snapshot précédent (premier sync après publish ou
  // forceFullSync), on tente toujours une résolution pour avoir une valeur
  // fiable dans le snapshot final.
  const allBjSizeNames = Array.from(
    new Set(linkedColors.flatMap((c) => c.variantSizes.map((vs) => vs.size.name))),
  );
  const prevSizeSet = new Set(
    (previousSnapshot?.variants ?? []).flatMap((v) => Object.keys(v.stockByTaille)),
  );
  const currentSizeSet = new Set(allBjSizeNames);
  const sizesChangedVsSnapshot = (() => {
    if (prevSizeSet.size === 0 && currentSizeSet.size === 0) return false;
    if (prevSizeSet.size !== currentSizeSet.size) return true;
    for (const s of currentSizeSet) if (!prevSizeSet.has(s)) return true;
    return false;
  })();

  let targetDeclinaisonId: number | null = previousSnapshot?.declinaisonId ?? null;
  if (
    allBjSizeNames.length > 0 &&
    (sizesChangedVsSnapshot || opts.forceFullSync || targetDeclinaisonId == null)
  ) {
    try {
      const declRes = await resolveEfashionDeclinaison(
        allBjSizeNames,
        product.reference,
      );
      if (declRes.success) {
        targetDeclinaisonId = declRes.match.declinaisonId;
        logger.info("[eFashion update] Déclinaison cible résolue", {
          productId,
          sizes: allBjSizeNames,
          declinaisonId: targetDeclinaisonId,
          createdNew: declRes.createdNew === true,
        });
      } else {
        logger.warn(
          "[eFashion update] Résolution déclinaison KO — on garde l'ancienne valeur",
          { productId, error: declRes.error },
        );
      }
    } catch (err) {
      logger.warn("[eFashion update] resolveEfashionDeclinaison a planté", {
        productId,
        error: err as Error,
      });
    }
  }

  // Dernier filet : si toujours rien (premier appel, pas de snapshot, et
  // resolve KO), on lit la valeur live observée chez eFashion pour figer le
  // snapshot avec une valeur cohérente plutôt que null.
  if (targetDeclinaisonId == null) {
    await ensureLiveById();
    for (const live of liveById.values()) {
      if (live.id_declinaison != null) {
        targetDeclinaisonId = live.id_declinaison;
        break;
      }
    }
  }

  const targetCategoryId = product.category?.efashionCategorieId ?? null;

  // La référence BJ peut avoir été renommée par l'admin depuis le dernier
  // sync. On cible désormais `product.reference` (nouveau nom) comme
  // `referenceBase` chez eFashion. La bascule est effectuée plus bas dans le
  // flow, on met à jour `Product.efashionReferenceBase` en même temps que le
  // snapshot pour que le prochain sync reparte sur la nouvelle base.
  const target: EfashionSnapshot = {
    version: 1,
    referenceBase: product.reference,
    variants: targetVariants,
    descriptions: targetDescriptions,
    compositions: targetCompositions,
    primaryEfashionProductId: bjPrimaryEfashionId,
    declinaisonId: targetDeclinaisonId,
    categoryId: targetCategoryId,
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
  // déclenché ici si le diff a besoin du contexte serveur). On force aussi
  // le fetch quand `linkedColors` est non vide pour pouvoir détecter les
  // dérives silencieuses `visible=false` (cf. bloc « détection dérive » ci-après).
  if (
    variantsToUpdate.length > 0 ||
    diff.primaryChanged ||
    diff.removed.length > 0 ||
    diff.declinaisonChanged ||
    diff.categoryChanged ||
    diff.referenceBaseChanged ||
    linkedColors.length > 0
  ) {
    await ensureLiveById();
  }

  // Renommage de la référence BJ (= `referenceBase` chez eFashion). Quand
  // l'admin renomme un produit (ex A1720 → A1721), on doit propager la
  // nouvelle référence à chaque variante eFashion via `updateProduit`
  // (champs `reference` + `reference_base`). Sans ça, eFashion garderait
  // l'ancien nom côté fiche acheteurs.
  //
  // On enqueue TOUTES les variantes liées connues côté eFashion (celles
  // présentes dans `liveById`) avec `fields=[]` : la boucle finale posera
  // les nouveaux `reference`/`reference_base` sans toucher aux prix, poids
  // ou visible (sauf si un autre diff les avait déjà enqueue à un titre
  // différent — dans ce cas on garde leur `fields` d'origine).
  const oldReferenceBase = product.efashionReferenceBase;
  if (diff.referenceBaseChanged && liveById.size > 0) {
    const alreadyQueued = new Set(variantsToUpdate.map((v) => v.variant.efashionProductId));
    for (const tv of targetVariants) {
      if (!liveById.has(tv.efashionProductId)) continue;
      if (alreadyQueued.has(tv.efashionProductId)) continue;
      variantsToUpdate.push({ variant: tv, fields: [] });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Détection dérive `visible` chez eFashion (bug PS3, 2026-07-28)
  // ─────────────────────────────────────────────────────────────────────
  // Même quand le diff local ne signale « aucun changement » (snapshot et
  // cible identiques), l'état réel côté eFashion peut avoir dérivé —
  // notamment `visible=false` forcé par un side-effect d'un push précédent,
  // ou modifié manuellement par l'admin puis re-forcé par la propagation
  // main lors du sync suivant.
  //
  // Si on constate que `live.visible !== target.visible` sur une variante
  // liée, on l'enqueue dans variantsToUpdate pour re-pousser la valeur
  // voulue. Idempotent : si la variante y est déjà, on n'ajoute rien.
  if (liveById.size > 0) {
    const alreadyQueued = new Set(variantsToUpdate.map((v) => v.variant.efashionProductId));
    for (const tv of targetVariants) {
      if (alreadyQueued.has(tv.efashionProductId)) continue;
      const live = liveById.get(tv.efashionProductId);
      if (live && live.visible !== tv.visible) {
        variantsToUpdate.push({ variant: tv, fields: ["visible"] as const });
        alreadyQueued.add(tv.efashionProductId);
        logger.info("[eFashion update] Dérive visible détectée — push forcé", {
          productId,
          efashionProductId: tv.efashionProductId,
          liveVisible: live.visible,
          targetVisible: tv.visible,
        });
      }
    }
  }

  // Changement de catégorie eFashion : la nouvelle catégorie doit être poussée
  // sur TOUTES les couleurs liées (eFashion stocke id_categorie par variante).
  // On enqueue chaque variante avec un flag `fields` vide — le payload complet
  // sera reconstruit dans la boucle finale via `live.*`, et on y injectera
  // `targetCategoryId` à la place de `live.id_categorie` (voir plus bas).
  //
  // Idempotent : si la variante est déjà dans la queue (parce que prix/poids/
  // visible a aussi changé), on ne la duplique pas.
  if (diff.categoryChanged && targetCategoryId != null) {
    const alreadyQueued = new Set(variantsToUpdate.map((v) => v.variant.efashionProductId));
    for (const tv of targetVariants) {
      if (!alreadyQueued.has(tv.efashionProductId)) {
        variantsToUpdate.push({ variant: tv, fields: [] as const });
      }
    }
    logger.info("[eFashion update] Catégorie changée — push forcé sur toutes les couleurs", {
      productId,
      newCategoryId: targetCategoryId,
      variantsAffected: targetVariants.length,
    });
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
  // Bascule de la déclinaison eFashion (« moule de tailles » du groupe)
  // ─────────────────────────────────────────────────────────────────────
  // Si l'utilisatrice a ajouté/retiré une taille au produit BJ et qu'on a
  // calculé une nouvelle déclinaison cible plus haut, on la pousse à chaque
  // couleur liée AVANT le push des stocks — sinon les stocks sur les
  // nouvelles tailles tombent dans le vide côté eFashion.
  //
  // Idempotent : on saute la couleur si elle est déjà sur la bonne
  // déclinaison côté live (cas typique d'un snapshot legacy sans
  // declinaisonId : `diff.declinaisonChanged` est true mais la valeur live
  // est déjà la bonne, donc rien à faire).
  let declinaisonUpdatedCount = 0;
  if (diff.declinaisonChanged && targetDeclinaisonId != null && liveById.size > 0) {
    for (const lc of linkedColors) {
      const efId = lc.efashionProductId;
      if (efId == null) continue;
      const live = liveById.get(efId);
      if (!live) continue;
      if (live.id_declinaison === targetDeclinaisonId) continue;
      try {
        const input: Parameters<typeof efashionUpdateProduit>[0] = {
          id_produit: efId,
          reference: live.reference,
          id_declinaison: targetDeclinaisonId,
          prixReduit: null,
        };
        if (live.reference_base) input.reference_base = live.reference_base;
        if (live.id_collection !== null) input.id_collection = live.id_collection;
        // `id_categorie` : cible BJ prioritaire, fallback live (voir bloc
        // updateProduit final pour la même logique).
        const effectiveCategoryId = targetCategoryId ?? live.id_categorie;
        if (effectiveCategoryId !== null) input.id_categorie = effectiveCategoryId;
        if (live.id_provenance !== null) input.id_provenance = live.id_provenance;
        if (live.id_pack !== null) input.id_pack = live.id_pack;
        if (live.vendu_par === "couleurs" || live.vendu_par === "tailles") {
          input.vendu_par = live.vendu_par;
        }
        if (live.id_vendeur_marque !== null) input.id_vendeur_marque = live.id_vendeur_marque;

        await efashionUpdateProduit(input);
        liveById.set(efId, { ...live, id_declinaison: targetDeclinaisonId });
        declinaisonUpdatedCount++;
        logger.info("[eFashion update] Déclinaison mise à jour pour couleur", {
          productId,
          efId,
          from: live.id_declinaison,
          to: targetDeclinaisonId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`updateProduit(declinaison)(${efId}): ${msg}`);
      }
    }
    if (declinaisonUpdatedCount > 0) {
      logger.info("[eFashion update] Déclinaison du groupe basculée", {
        productId,
        colorsUpdated: declinaisonUpdatedCount,
        newDeclinaisonId: targetDeclinaisonId,
      });
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
      // ⚠️ Nettoie aussi le numéro eFashion côté BDD locale — sinon un orphelin
      // (efashionProductId pointant vers un produit soft-deleted chez eFashion)
      // reste sur la ProductColor et plante toutes les sync futures : eFashion
      // accepte les updates sur un id supprimé en répondant `200 OK` sans rien
      // faire (cas W124/Fuchsia 25/06/2026 → erreur muette pendant 4 jours).
      const removedCount = await prisma.productColor.updateMany({
        where: {
          productId: product.id,
          efashionProductId: { in: diff.removed },
        },
        data: { efashionProductId: null },
      });
      logger.info("[eFashion update] Couleurs supprimées côté eFashion (softDelete)", {
        productId,
        efIds: diff.removed,
        productColorsCleared: removedCount.count,
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
  // Exception : pendant l'alignement post-publish (chemin appelé en fin de
  // `efashionPublishProduct` avec `isPostPublishAlignment=true`), toutes les
  // variantes sont nouvellement créées par `saveMelDraft` et sont garanties
  // d'être dans `liveById` — pas de skip à faire.
  //
  // ⚠️ Avant juin 2026 ce filet utilisait `previousSnapshot !== null` comme
  // discriminant, mais ça désactivait à tort le filet en mode « Rafraîchir »
  // (forceFullSync, qui met previousSnapshot à null) — laissant les
  // efashionProductId orphelins passer à travers et générer des « 200 OK
  // silencieux » côté eFashion (cas W124/Fuchsia 25-29/06/2026).
  const skippedAddedEfIds =
    !opts.isPostPublishAlignment && liveById.size > 0
      ? computeOrphanEfashionIds(
          diff.added,
          new Set(liveById.keys()),
          realPrevSnapshot?.variants ?? null,
        )
      : new Set<number>();
  if (skippedAddedEfIds.size > 0) {
    colorsSkippedCount = skippedAddedEfIds.size;
    errors.push(
      `Erreur de liaison : ${skippedAddedEfIds.size} produit(s) introuvable(s) côté eFashion ` +
        `(id_produit: ${[...skippedAddedEfIds].join(", ")}). ` +
        "Veuillez rafraîchir le produit ou le relier à eFashion.",
    );
    variantsToUpdate = variantsToUpdate.filter(
      (v) => !skippedAddedEfIds.has(v.variant.efashionProductId),
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stock — DOIT être poussé AVANT updateProduit
  // ─────────────────────────────────────────────────────────────────────
  // ⚠️ eFashion **refuse silencieusement `visible=true`** quand le
  // `stock_value` côté eFashion est encore à 0 — la mutation `updateProduit`
  // renvoie `visible:true` dans la réponse mais l'état persisté reste
  // `visible:false`. Et comme la main propage visible aux non-main du groupe,
  // une seule couleur bloquée à false fait basculer tout le groupe en caché.
  // Reproduit sur F137 (Argent stock=0 côté eFashion, BJ=1000) le 2026-05-30 :
  // pousser stocks AVANT updateProduit débloque `visible=true` proprement.
  //
  // Le mapping `id_couleur` est partagé avec le bloc updateProduit qui suit.
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
      // Override eFashion prioritaire sur le mapping principal Color.efashionColorId.
      const principal = localColorIdToEfashion.get(lc.colorId) ?? null;
      const effective = lc.efashionColorIdOverride ?? principal;
      efIdToColorId.set(lc.efashionProductId, effective);
    }
  }

  // Libellés de tailles eFashion pour la déclinaison cible — nécessaires pour
  // mapper les noms de tailles BJ ("TU", "S", ...) vers les libellés exacts
  // eFashion ("Taille unique", "S", ...) attendus par `upsertProduitStock`.
  // Sans ce mapping, eFashion ignore silencieusement le stock (signature
  // observée dans le HAR de leur UI le 2026-05-30 : `taille: "Taille unique"`
  // au lieu de `null`).
  let declSizes: Array<{ field: string; value: string }> = [];
  if (targetDeclinaisonId != null) {
    try {
      const { getEfashionAnnexes } = await import("@/lib/efashion-annexes");
      const annexes = await getEfashionAnnexes();
      const decl = annexes.declinaisons.find((d) => d.id === targetDeclinaisonId);
      declSizes = decl?.sizes ?? [];
    } catch (err) {
      logger.warn("[eFashion update] Lecture des libellés de déclinaison KO", {
        productId,
        targetDeclinaisonId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const resolveTailleLabel = (bjName: string): string => {
    const norm = bjName.trim().toLowerCase();
    // 1. Match exact (insensible à la casse / espaces) avec un des dN_FR.
    for (const s of declSizes) {
      if (s.value.trim().toLowerCase() === norm) return s.value;
    }
    // 2. Cas "TU" (taille placeholder BJ) → 1ʳᵉ taille de la déclinaison
    //    (typiquement "Taille unique" pour une déclinaison à 1 taille).
    if (norm === "tu" && declSizes.length >= 1) return declSizes[0].value;
    // 3. Fallback : on renvoie le nom BJ tel quel — meilleur effort si la
    //    déclinaison n'a pas été chargée, eFashion peut accepter quand même
    //    si les libellés coïncident par chance.
    return bjName;
  };

  // Trace ce qu'on va envoyer (utile quand une couleur saute silencieusement) :
  // si `id_couleur` manque côté Color.efashionColorId, on saute la variante et
  // la cliente voyait avant des logs muets côté serveur sans rien sur eFashion.
  logger.info("[eFashion update] Préparation push stock", {
    productId,
    declSizes: declSizes.map((s) => s.value),
    variantsCount: diff.added.length + diff.changed.length,
    payloadPreview: [...diff.added, ...diff.changed.map((c) => c.after)].map((v) => ({
      efId: v.efashionProductId,
      idCouleur: efIdToColorId.get(v.efashionProductId) ?? null,
      stockByTaille: v.stockByTaille,
      skipped: skippedAddedEfIds.has(v.efashionProductId),
    })),
  });

  // 1 mutation `upsertProduitStock` par (couleur, taille) — c'est ce que fait
  // l'UI eFashion (cf. HAR). Pas de batch : la mutation `saveProduitStocks`
  // (au pluriel) a été dépréciée côté eFashion et renvoie `true` sans persister.
  for (const v of [...diff.added, ...diff.changed.map((c) => c.after)]) {
    // Skip les couleurs ajoutées qu'eFashion ne connaît pas (voir bloc de
    // filtrage plus haut) — on ne peut pas pousser de stock vers un produit
    // qui n'existe pas côté eFashion.
    if (skippedAddedEfIds.has(v.efashionProductId)) continue;
    const idCouleur = efIdToColorId.get(v.efashionProductId);
    if (!idCouleur) {
      // Cas pénible mais récurrent : la Color BJ liée à cette variante n'a pas
      // d'efashionColorId. Sans cet id, eFashion ignore l'upsert. On remonte
      // une erreur explicite plutôt que de sauter en silence — l'utilisatrice
      // doit aller mapper la couleur dans Paramètres > Bibliothèques > Couleurs.
      const msg = `Couleur BJ liée à eFashion product ${v.efashionProductId} sans efashionColorId — stock non envoyé. Mapper la couleur dans Paramètres > Bibliothèques > Couleurs.`;
      logger.warn("[eFashion update] Stock skip — id_couleur manquant", {
        productId,
        efId: v.efashionProductId,
      });
      errors.push(msg);
      continue;
    }
    for (const [taille, value] of Object.entries(v.stockByTaille)) {
      const tailleLabel = resolveTailleLabel(taille);
      try {
        await efashionUpsertProduitStock({
          id_produit: v.efashionProductId,
          id_couleur: idCouleur,
          value,
          taille: tailleLabel,
        });
        stockMutations++;
        logger.info("[eFashion update] upsertProduitStock OK", {
          efId: v.efashionProductId,
          idCouleur,
          value,
          taille: tailleLabel,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`upsertProduitStock(${v.efashionProductId}/${tailleLabel}): ${msg}`);
        logger.warn("[eFashion update] upsertProduitStock KO", {
          efId: v.efashionProductId,
          idCouleur,
          value,
          taille: tailleLabel,
          error: msg,
        });
      }
    }
  }

  // (Le bloc updateProduit a été déplacé APRÈS la sync photos — voir plus bas
  // pour la raison : `efashionDeleteProductPhoto` qui vide la liste des photos
  // d'une couleur force `visible=false` côté eFashion. Si on pose visible=true
  // AVANT la purge photos, il est écrasé.)

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
      // Skip les orphelins inconnus d'eFashion — sinon saveProduitDescription
      // répond `OK` mais ne fait rien (cas W124/Fuchsia 29/06/2026).
      if (skippedAddedEfIds.has(efId)) continue;
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
      // Idem description : on ne pousse pas vers un id orphelin.
      if (skippedAddedEfIds.has(efId)) continue;
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
    // ⚠️ Même en forceFullSync on retire les efashionProductId orphelins (cf.
    // bloc « Filtrage des couleurs ajoutées localement mais inconnues d'eFashion »).
    // Sans ce skip, on uploadait des photos vers un id_produit fantôme qui
    // renvoyait `200 OK` sans rien stocker (cas W124/Fuchsia 29/06/2026).
    variantsNeedingImageSync.push(
      ...targetVariants.filter(
        (v) =>
          v.images &&
          v.images.length > 0 &&
          !skippedAddedEfIds.has(v.efashionProductId),
      ),
    );
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

    // Toggle badge « Réf » : la 1ère image de la couleur principale reçoit
    // le badge composé en mémoire côté efashionUploadProductPhotos.
    const brandedBadgeRow = await prisma.siteConfig.findFirst({
      where: { key: "branded_reference_badge_enabled" },
      select: { value: true },
    });
    const brandedBadgeEnabled = brandedBadgeRow?.value === "true";
    const primaryColorId = product.primaryColorId ?? null;

    const productRefBase = product.efashionReferenceBase;
    // Le serveur wapi.efashion-paris.com est irrégulier : socket hang up,
    // ECONNRESET et 502 Bad Gateway sont observés à intervalles réguliers.
    // Sans retry, un simple glitch pendant la purge (GET photos) ou pendant
    // un upload multipart fait remonter un `TypeError: fetch failed` opaque
    // (cf. incidents 2026-08-02 sur eFashion 3771865 / 3774287, tenant issyma).
    // On tolère 2 échecs consécutifs par variante avec un petit backoff.
    const MAX_ATTEMPTS = 3;
    for (const variant of variantsNeedingImageSync) {
      const efId = variant.efashionProductId;
      const images = variant.images ?? [];
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
          const isPrimaryVariant =
            brandedBadgeEnabled &&
            primaryColorId != null &&
            localColor?.colorId === primaryColorId &&
            sorted.length > 0;
          // Toggle branded actif sur la couleur principale :
          //   → upload 1 = badge composé sur la source (devient c.jpg côté eFashion)
          //   → upload 2 = même source, brute (devient z-1.jpg)
          //   → uploads 3..5 = photos brutes suivantes (z-2.jpg, z-3.jpg, z-4.jpg)
          // Cap à 5 uploads (comme les autres couleurs).
          interface UploadEntry { dbPath: string; branded: boolean }
          const uploadList: UploadEntry[] = isPrimaryVariant
            ? [
                { dbPath: sorted[0]!.dbPath, branded: true },
                ...sorted.slice(0, 4).map((img) => ({ dbPath: img.dbPath, branded: false })),
              ]
            : sorted.slice(0, 5).map((img) => ({ dbPath: img.dbPath, branded: false }));
          for (let idx = 0; idx < uploadList.length; idx++) {
            const entry = uploadList[idx]!;
            await efashionUploadProductPhotos(efId, [
              {
                dbPath: entry.dbPath,
                filename: `${productRefBase}-${colorName}-${idx + 1}.jpg`,
                ...(entry.branded ? { brandedReference: product.reference } : {}),
              },
            ]);
          }
          imagesUpdatedCount++;
          logger.info("[eFashion] Photos resynchronisées", {
            efId,
            count: uploadList.length,
            brandedInserted: isPrimaryVariant,
            attempt,
          });
          lastError = null;
          break; // succès → sortie de la boucle retry
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          // Sortir la vraie cause quand undici emballe l'erreur réseau dans
          // un `TypeError: fetch failed` opaque. `err.cause` contient l'objet
          // Error de bas niveau (code: 'UND_ERR_SOCKET' / 'ECONNRESET' / etc.).
          const cause = (err as { cause?: unknown }).cause;
          const causeMsg = cause instanceof Error
            ? `${(cause as Error & { code?: string }).code ?? cause.name}: ${cause.message}`
            : cause !== undefined ? String(cause) : "";
          logger.warn("[eFashion] syncPhotos tentative échouée", {
            efId,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
            error: msg,
            cause: causeMsg || undefined,
          });
          if (attempt < MAX_ATTEMPTS) {
            // Backoff court : 800 ms puis 1600 ms. Le CDN eFashion se remet
            // souvent en < 1 s après un socket hang up. Pas de jitter — le
            // volume par produit est bas (1-5 variantes × 2 retries max).
            await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
          }
        }
      }
      if (lastError !== null) {
        const msg = lastError instanceof Error ? lastError.message : String(lastError);
        const cause = (lastError as { cause?: unknown }).cause;
        const causeMsg = cause instanceof Error
          ? ` (${(cause as Error & { code?: string }).code ?? cause.name})`
          : "";
        errors.push(`syncPhotos(${efId}): ${msg}${causeMsg}`);
      }
    }
  } else {
    logger.info("[eFashion] Photos inchangées, skip", { productId });
  }

  // ─────────────────────────────────────────────────────────────────────
  // updateProduit (visible / prix / poids) — DOIT venir EN DERNIER
  // ─────────────────────────────────────────────────────────────────────
  // ⚠️ Découvert le 2026-05-30 sur F137 : quand `efashionDeleteProductPhoto`
  // vide la liste des photos d'une couleur (étape de purge avant re-upload),
  // eFashion force `visible=false` automatiquement sur cette couleur (logique
  // back « produit sans photo = caché »). L'upload qui suit ne le remet PAS
  // à `true`. Donc poser `visible=true` AVANT la sync photos est inutile —
  // il faut le poser APRÈS pour avoir le dernier mot.
  //
  // ⚠️ Ordre crucial à l'intérieur de la boucle : la couleur eFashion
  // `main=true` propage ses valeurs aux autres couleurs liées si on envoie
  // un payload partiel. On l'envoie en PREMIER, puis les non-main après
  // (qui restent isolées et conservent leur prix/poids spécifique). Sans
  // cet ordre, un update sur la main APRÈS un non-main écrase le non-main
  // qu'on venait de poser. Découvert via HAR de leur UI (mai 2026).
  variantsToUpdate.sort((a, b) => {
    const aMain = liveById.get(a.variant.efashionProductId)?.main ? 1 : 0;
    const bMain = liveById.get(b.variant.efashionProductId)?.main ? 1 : 0;
    return bMain - aMain; // main (1) avant non-main (0)
  });

  // ⚠️ Cheffe de groupe cible (= main eFashion souhaitée). Priorité à la
  // primaire BJ ; sinon on retombe sur la main actuelle observée côté eFashion.
  // Utilisé pour réécrire `id_couleur_liee` sur **toutes** les variantes — sans
  // ça, après une bascule main, les non-main qui n'étaient pas dans la bascule
  // restent pointées vers l'ANCIENNE main (devenue non-main) et eFashion les
  // affiche comme un produit séparé. Cf. bug BOUCLESOREILLES01 (30/05/2026) :
  // la 3ᵉ couleur (Blanc) gardait `id_couleur_liee = ancien main` → orpheline.
  let targetGroupLeaderEfId: number | null = null;
  if (bjPrimaryEfashionId !== null && liveById.has(bjPrimaryEfashionId)) {
    targetGroupLeaderEfId = bjPrimaryEfashionId;
  } else {
    for (const [efId, live] of liveById) {
      if (live.main) {
        targetGroupLeaderEfId = efId;
        break;
      }
    }
  }

  for (const { variant, fields } of variantsToUpdate) {
    try {
      const live = liveById.get(variant.efashionProductId);
      const input: Parameters<typeof efashionUpdateProduit>[0] = {
        id_produit: variant.efashionProductId,
      };
      // Recopie des champs « stables » lus chez eFashion — sans ça, eFashion
      // propage prix/poids/visible à toutes les couleurs.
      //
      // ⚠️ `id_categorie` : source de vérité = BJ (`targetCategoryId`). Si la
      // cliente a changé la catégorie BJ, on la pousse à chaque variante. Si
      // BJ n'a pas de mapping eFashion (efashionCategorieId=null), on retombe
      // sur la valeur live pour ne pas envoyer null (eFashion refuserait).
      if (live) {
        // Si l'admin a renommé la référence BJ, on repointe `reference` et
        // `reference_base` sur la nouvelle base tout en préservant le suffixe
        // « -COULEUR » de l'ancienne référence eFashion (ex : A1720-BLEU →
        // A1721-BLEU). Si le suffixe n'est pas déductible (référence live qui
        // ne commence pas par l'ancienne base), on renomme quand même la
        // reference_base et on garde la reference telle quelle.
        if (diff.referenceBaseChanged) {
          const suffix = live.reference.startsWith(oldReferenceBase)
            ? live.reference.slice(oldReferenceBase.length)
            : null;
          input.reference = suffix !== null ? `${product.reference}${suffix}` : live.reference;
          input.reference_base = product.reference;
        } else {
          input.reference = live.reference;
          if (live.reference_base) input.reference_base = live.reference_base;
        }
        if (live.id_collection !== null) input.id_collection = live.id_collection;
        const effectiveCategoryId = targetCategoryId ?? live.id_categorie;
        if (effectiveCategoryId !== null) input.id_categorie = effectiveCategoryId;
        if (live.id_provenance !== null) input.id_provenance = live.id_provenance;
        if (live.id_declinaison !== null) input.id_declinaison = live.id_declinaison;
        if (live.id_pack !== null) input.id_pack = live.id_pack;
        if (live.vendu_par === "couleurs" || live.vendu_par === "tailles") {
          input.vendu_par = live.vendu_par;
        }
        if (live.id_vendeur_marque !== null) input.id_vendeur_marque = live.id_vendeur_marque;
        input.prixReduit = null;
      }
      // Re-rattachement systématique au groupe : on dit à chaque variante qui
      // est sa cheffe et si elle EST la cheffe. Idempotent quand rien n'a
      // changé, mais indispensable pour rattraper les non-main qui pointaient
      // vers l'ancienne main après une bascule.
      if (targetGroupLeaderEfId !== null) {
        input.id_couleur_liee = targetGroupLeaderEfId;
        input.main = variant.efashionProductId === targetGroupLeaderEfId;
      }
      // ⚠️ `visible` est TOUJOURS envoyé (pas seulement quand `fields` le
      // contient). Raison : le payload contient déjà `main` + `id_couleur_liee`
      // (rattachement systématique au groupe, ligne 1667). eFashion, quand il
      // reçoit `main=true` sans `visible` explicite, propage la valeur `visible`
      // MÉMORISÉE côté eFashion de la main aux autres couleurs du groupe. Si
      // cette valeur mémorisée est stale (ex: false alors que BJ dit true), on
      // se retrouve avec toutes les couleurs cachées après chaque sync — même
      // si l'admin a corrigé manuellement dans l'UI eFashion.
      // Bug reproduit sur PS3 le 2026-07-28 : visible=true manuel côté eFashion
      // → sync BJ → propagation main → visible=false partout. Fix : asserter la
      // valeur voulue par BJ à chaque updateProduit, sans dépendre du diff.
      input.visible = variant.visible;
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
        // Push OK → on retire le drapeau « Synchro nécessaire »
        efashionSyncRequired: false,
        // Aligne la référence stockée si l'admin a renommé le produit BJ
        // et que le rename a bien été poussé côté eFashion. Sans ça, le
        // prochain sync repointerait `referenceBase` du snapshot cible sur
        // l'ancienne valeur → boucle infinie de « rename ».
        ...(diff.referenceBaseChanged ? { efashionReferenceBase: product.reference } : {}),
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
    declinaisonUpdatedCount,
    unlinkedVariants: unlinkedCount,
  };
}

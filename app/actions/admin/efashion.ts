"use server";

/**
 * eFashion Paris — Server actions pour la liaison manuelle (Lot 2).
 *
 * eFashion stocke chaque couleur d'un produit comme une ligne séparée
 * (cf. docs/efashion-api.md). Pour lier un produit BJ à eFashion, on doit
 * mapper chaque couleur BJ à un `id_produit` eFashion. Ils partagent tous
 * le même `reference_base` côté eFashion.
 *
 * Flux UI :
 *   1. searchEfashionByReference(referenceBase) → preview de tous les
 *      produits-couleurs eFashion correspondants
 *   2. linkEfashionProductManually(productId, links) → écrit les IDs en BDD
 *   3. removeEfashionMatch(productId) → délie tout
 */

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  efashionListByReferenceBaseExact,
  efashionGetMe,
  type EfashionProductListItem,
} from "@/lib/efashion-api";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export interface EfashionLinkCandidate {
  efashionProductId: number;
  reference: string;          // ex: "A2415-DORÉ"
  efashionColorId: number;
  efashionColorName: string;
  visible: boolean;
  supprimer: boolean;
  stockValue: number | null;
  nbPhotos: number;
  /** URL publique de la 1ʳᵉ photo eFashion (peut être 404 si nbPhotos=0). */
  imageUrl: string | null;
  /** Couleur locale BJ pré-suggérée par matching insensible aux accents/case (peut être null). */
  suggestedLocalColorId: string | null;
}

export interface EfashionLinkLocalColor {
  id: string;
  name: string;
  /** Code hex (ex: #C9A961) — utilisé si patternImage absent. */
  hex: string | null;
  /** Image motif de la couleur (prioritaire sur hex). */
  patternImage: string | null;
  /** Aperçu de la 1ʳᵉ image de la variante UNIT (peut être null). */
  productImage: string | null;
  /** Prix unitaire affiché (variante UNIT). */
  unitPrice: number | null;
  /** Stock UNIT cumulé pour cette couleur. */
  unitStock: number | null;
}

export interface EfashionPackOnlyColor {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
}

export interface EfashionLinkPreview {
  productId: string;
  productName: string;
  reference: string;
  referenceBase: string;
  /** Couleurs BJ ayant au moins une variante UNIT — celles qu'on peut lier à eFashion. */
  localColors: EfashionLinkLocalColor[];
  /** Couleurs BJ qui n'existent qu'en PACK — affichées en info, non liables. */
  packOnlyColors: EfashionPackOnlyColor[];
  candidates: EfashionLinkCandidate[];
  /** Total renvoyé par eFashion pour ce filtre (peut être > candidates.length si pagination). */
  totalOnEfashion: number;
  /** Liste lisible des attributs BJ sans mapping eFashion (catégorie, pays,
   * saison, matières, couleurs). Doit être vide pour autoriser la liaison. */
  missingAttributes: string[];
  /** Liens déjà sauvés en BDD : map { Color.id → efashionProductId } pour
   * pré-remplir la modale avec l'état actuel (et pas juste les suggestions
   * par nom). Permet à l'utilisatrice de voir ce qui est déjà lié quand elle
   * rouvre la modale. */
  existingLinks: Record<string, number>;
  /** True si le produit est déjà lié à eFashion (Product.efashionReferenceBase
   * renseigné). Indication d'état pour l'UI. */
  alreadyLinked: boolean;
}

/**
 * Construit l'URL du proxy admin qui sert les images eFashion authentifiées.
 * Les images eFashion sont protégées par cookie de session (le navigateur de
 * l'admin n'a pas ce cookie) — on passe donc par notre route admin qui les
 * récupère côté serveur. Cf. `app/api/admin/efashion-image/route.ts`.
 */
function buildEfashionPhotoUrl(idProduit: number): string {
  return `/api/admin/efashion-image?id=${idProduit}`;
}

function normalizeColorName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Prépare l'écran de mapping : interroge eFashion pour récupérer toutes les
 * lignes correspondant à la référence du produit, puis suggère le mapping
 * couleur par couleur.
 */
export async function previewEfashionMatchByReference(
  productId: string,
  referenceBaseInput?: string,
): Promise<{ success: true; data: EfashionLinkPreview } | { success: false; error: string }> {
  try {
    await requireAdmin();

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        name: true,
        efashionReferenceBase: true,
        category: { select: { id: true, name: true, efashionCategorieId: true } },
        manufacturingCountry: {
          select: { id: true, name: true, efashionProvenanceId: true },
        },
        season: { select: { id: true, name: true, efashionCollectionId: true } },
        compositions: {
          select: {
            composition: { select: { id: true, name: true, efashionId: true } },
          },
        },
        colors: {
          select: {
            id: true,
            saleType: true,
            unitPrice: true,
            stock: true,
            efashionProductId: true,
            color: {
              select: {
                id: true,
                name: true,
                hex: true,
                patternImage: true,
                efashionColorId: true,
              },
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

    // Validation centrale des attributs eFashion : on liste tout ce qui manque
    // pour pouvoir pousser proprement vers eFashion (catégorie, pays, saison,
    // matières, couleurs UNIT). Les tailles ne sont pas listées ici car la
    // déclinaison eFashion est résolue dynamiquement à la publication
    // (cf. resolveEfashionDeclinaison dans lib/efashion-publish.ts).
    const missingAttributes: string[] = [];
    if (!product.category?.efashionCategorieId) {
      missingAttributes.push(
        `Catégorie « ${product.category?.name ?? "(non renseignée)"} » sans mapping eFashion`,
      );
    }
    if (!product.manufacturingCountry?.efashionProvenanceId) {
      missingAttributes.push(
        `Pays de fabrication « ${product.manufacturingCountry?.name ?? "(non renseigné)"} » sans mapping eFashion`,
      );
    }
    if (!product.season?.efashionCollectionId) {
      missingAttributes.push(
        `Saison « ${product.season?.name ?? "(non renseignée)"} » sans mapping eFashion`,
      );
    }
    if (product.compositions.length === 0) {
      missingAttributes.push("Au moins une matière (composition) est requise");
    } else {
      for (const pc of product.compositions) {
        if (!pc.composition.efashionId) {
          missingAttributes.push(
            `Matière « ${pc.composition.name} » sans mapping eFashion`,
          );
        }
      }
    }
    // Couleurs UNIT : chacune doit avoir son efashionColorId
    const unitColorIds = new Set<string>();
    for (const pc of product.colors) {
      if (pc.saleType === "UNIT" && pc.color) unitColorIds.add(pc.color.id);
    }
    const seenColors = new Set<string>();
    for (const pc of product.colors) {
      if (pc.saleType !== "UNIT" || !pc.color) continue;
      if (seenColors.has(pc.color.id)) continue;
      seenColors.add(pc.color.id);
      if (!pc.color.efashionColorId) {
        missingAttributes.push(
          `Couleur « ${pc.color.name} » sans mapping eFashion`,
        );
      }
    }
    if (unitColorIds.size === 0) {
      missingAttributes.push(
        "Au moins une variante à l'unité est requise (eFashion ignore les paquets)",
      );
    }

    // On déduit la référence à interroger : champ saisi par l'utilisatrice,
    // sinon référence déjà liée, sinon référence BJ (sans suffixe couleur).
    const referenceBase = (referenceBaseInput?.trim() ||
      product.efashionReferenceBase ||
      product.reference.split(/[-_]/)[0]).trim();

    if (!referenceBase) return { success: false, error: "Référence vide." };

    const vendor = await efashionGetMe();

    // Recherche paginée + filtre strict — délégué à
    // `efashionListByReferenceBaseExact` (voir lib/efashion-api.ts pour le
    // détail). « tous » plutôt que « en_ligne » : on couvre aussi les fiches
    // en brouillon ou soft-deleted, sinon les produits créés manuellement
    // côté eFashion en brouillon ne ressortent pas.
    const filteredItems = await efashionListByReferenceBaseExact({
      idVendeur: vendor.id_vendeur,
      referenceBase,
      premelFilter: "tous",
    });

    // Groupage par Color.id : on agrège les variantes UNIT et PACK partageant
    // la même couleur. eFashion ne synchronise QUE les variantes UNIT (cf.
    // lib/efashion-publish.ts, lib/efashion-update.ts), donc :
    //  - une couleur ayant au moins une variante UNIT → liable, on prend ses
    //    infos UNIT (image, prix, stock cumulé) pour l'affichage
    //  - une couleur 100% PACK → listée à part pour info, mais pas liable
    const colorBuckets = new Map<
      string,
      {
        id: string;
        name: string;
        hex: string | null;
        patternImage: string | null;
        norm: string;
        unitImage: string | null;
        unitPrice: number | null;
        unitStock: number;
        hasUnit: boolean;
      }
    >();
    for (const pc of product.colors) {
      if (!pc.color) continue;
      const colorId = pc.color.id;
      const bucket = colorBuckets.get(colorId) ?? {
        id: colorId,
        name: pc.color.name,
        hex: pc.color.hex,
        patternImage: pc.color.patternImage,
        norm: normalizeColorName(pc.color.name),
        unitImage: null,
        unitPrice: null,
        unitStock: 0,
        hasUnit: false,
      };
      if (pc.saleType === "UNIT") {
        bucket.hasUnit = true;
        bucket.unitStock += pc.stock ?? 0;
        if (bucket.unitPrice === null) bucket.unitPrice = Number(pc.unitPrice);
        if (!bucket.unitImage && pc.images.length > 0) {
          bucket.unitImage = pc.images[0].path;
        }
      }
      colorBuckets.set(colorId, bucket);
    }

    const linkableColors = Array.from(colorBuckets.values()).filter((b) => b.hasUnit);
    const packOnlyColors: EfashionPackOnlyColor[] = Array.from(colorBuckets.values())
      .filter((b) => !b.hasUnit)
      .map((b) => ({
        id: b.id,
        name: b.name,
        hex: b.hex,
        patternImage: b.patternImage,
      }));

    const candidates: EfashionLinkCandidate[] = filteredItems.map(
      (it: EfashionProductListItem) => {
        const norm = normalizeColorName(it.couleur);
        const suggested = linkableColors.find((c) => c.norm === norm);
        return {
          efashionProductId: it.id_produit,
          reference: it.reference,
          efashionColorId: it.id_couleur,
          efashionColorName: it.couleur,
          visible: it.visible,
          supprimer: it.supprimer,
          stockValue: it.stock_value,
          nbPhotos: it.nb_photos,
          imageUrl: it.nb_photos > 0 ? buildEfashionPhotoUrl(it.id_produit) : null,
          suggestedLocalColorId: suggested?.id ?? null,
        };
      },
    );

    return {
      success: true,
      data: {
        productId: product.id,
        productName: product.name,
        reference: product.reference,
        referenceBase,
        localColors: linkableColors.map((c) => ({
          id: c.id,
          name: c.name,
          hex: c.hex,
          patternImage: c.patternImage,
          productImage: c.unitImage,
          unitPrice: c.unitPrice,
          unitStock: c.hasUnit ? c.unitStock : null,
        })),
        packOnlyColors,
        candidates,
        // On expose le nombre exact (après filtre strict) plutôt que `list.total`
        // qui inclut les références partielles non pertinentes.
        totalOnEfashion: candidates.length,
        missingAttributes,
        existingLinks: (() => {
          // Reconstitue le mapping { Color.id → efashionProductId } à partir de
          // la BDD pour que la modale puisse refléter l'état réel à la
          // réouverture (et pas uniquement les suggestions par nom).
          const out: Record<string, number> = {};
          for (const pc of product.colors) {
            if (
              pc.saleType === "UNIT" &&
              pc.efashionProductId !== null &&
              pc.color &&
              !(pc.color.id in out)
            ) {
              out[pc.color.id] = pc.efashionProductId;
            }
          }
          return out;
        })(),
        alreadyLinked: !!product.efashionReferenceBase,
      },
    };
  } catch (err) {
    logger.warn("[eFashion] previewEfashionMatchByReference failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Écrit les correspondances en BDD : pour chaque couleur locale, on stocke
 * l'`id_produit` eFashion correspondant. On stocke aussi la `referenceBase`
 * sur Product et on reset le snapshot pour forcer un full resync à la
 * prochaine sync.
 */
export async function linkEfashionProductManually(
  productId: string,
  referenceBase: string,
  links: Array<{ localColorId: string; efashionProductId: number; efashionColorId?: number }>,
): Promise<{
  success: boolean;
  error?: string;
  linked?: number;
  /**
   * Nombre de couleurs locales sans correspondance eFashion qui ont été
   * créées automatiquement côté eFashion par la sync post-liaison (via
   * duplicateWithNewColor + publishBrouillon). 0 = liaison « plate ».
   */
  autoCreatedOnEfashion?: number;
  /** Warning non bloquant : la liaison est posée mais la sync stock/prix
   * post-liaison a échoué. L'admin peut relancer "Resync" depuis la fiche. */
  syncWarning?: string;
}> {
  try {
    await requireAdmin();

    if (!referenceBase.trim()) {
      return { success: false, error: "Référence eFashion vide." };
    }

    // Validation : pas de doublon d'id_produit eFashion (1 ligne eFashion = 1 couleur BJ max)
    const seenEfId = new Set<number>();
    for (const l of links) {
      if (seenEfId.has(l.efashionProductId)) {
        return { success: false, error: `Le produit-couleur eFashion ${l.efashionProductId} apparaît plusieurs fois.` };
      }
      seenEfId.add(l.efashionProductId);
    }

    // Validation : couleurs locales toutes différentes
    const seenLocal = new Set<string>();
    for (const l of links) {
      if (seenLocal.has(l.localColorId)) {
        return { success: false, error: "Une couleur locale est liée à plusieurs produits eFashion." };
      }
      seenLocal.add(l.localColorId);
    }

    // Validation stricte « tout doit être lié » : on refuse si la moindre
    // variante UNIT BJ ou la moindre ligne eFashion restent orphelines. On
    // refait un preview côté serveur pour avoir l'état authoritative — ça
    // empêche aussi un client malicieux/buggué de contourner la règle.
    const previewRes = await previewEfashionMatchByReference(productId, referenceBase);
    if (!previewRes.success) {
      return { success: false, error: previewRes.error };
    }
    const preview = previewRes.data;

    // Validation des attributs eFashion (catégorie, pays, saison, matières,
    // couleurs) — tout doit être mappé avant de pouvoir lier/publier.
    if (preview.missingAttributes.length > 0) {
      return {
        success: false,
        error:
          "Attributs eFashion manquants — réglez-les d'abord :\n• " +
          preview.missingAttributes.join("\n• "),
      };
    }

    // Validation asymétrique :
    //   - BJ orphans (couleurs chez nous sans correspondance eFashion) : AUTORISÉES.
    //     Elles seront créées automatiquement côté eFashion par la sync
    //     post-liaison (cf. lib/efashion-update.ts > auto-création via
    //     duplicateWithNewColor + publishBrouillon).
    //   - eFashion orphans (lignes chez eux sans correspondance chez nous) :
    //     BLOQUANTES. L'admin doit d'abord les assigner à une couleur locale,
    //     les créer chez nous (bouton « Créer chez nous »), ou les supprimer
    //     côté eFashion. Sans ça, eFashion garderait des couleurs "fantômes"
    //     non synchronisées par BJ.
    const linkedEf = new Set(links.map((l) => l.efashionProductId));
    const orphanEf = preview.candidates.filter((c) => !linkedEf.has(c.efashionProductId));
    if (orphanEf.length > 0) {
      return {
        success: false,
        error:
          `Liaison impossible — ${orphanEf.length} couleur(s) chez eFashion sans équivalent chez vous :\n• ` +
          orphanEf.map((c) => c.efashionColorName).join("\n• ") +
          "\nDans la modale : pour chaque ligne, choisissez « Créer chez nous » " +
          "ou « Supprimer chez eFashion » avant de lier.",
      };
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, colors: { select: { id: true, colorId: true } } },
    });
    if (!product) return { success: false, error: "Produit introuvable." };

    // Précharge le mapping global BJ (Color.efashionColorId) pour toutes les
    // couleurs à lier. Sert à décider, pour chaque lien, si on doit poser
    // l'override sur ProductColor (cas où id_couleur du produit eFashion
    // existant ≠ mapping global BJ — sinon la sync stock pousserait sur un
    // id_couleur différent et créerait une entrée orpheline côté eFashion,
    // ce qui aboutit à un double stock affiché).
    const colorIdsToLink = Array.from(new Set(links.map((l) => l.localColorId)));
    const linkedColorRows = await prisma.color.findMany({
      where: { id: { in: colorIdsToLink } },
      select: { id: true, efashionColorId: true },
    });
    const globalEfashionColorIdByLocalId = new Map(
      linkedColorRows.map((c) => [c.id, c.efashionColorId]),
    );

    await prisma.$transaction(async (tx) => {
      // Stocke la reference_base + reset snapshot pour forcer le full resync.
      await tx.product.update({
        where: { id: productId },
        data: {
          efashionReferenceBase: referenceBase.trim(),
          efashionLastSyncSnapshot: Prisma.DbNull,
        },
      });

      // Pour chaque couleur, retrouve la ProductColor et pose efashionProductId.
      // On efface d'abord tous les efashionProductId de ce produit pour repartir propre.
      // On efface aussi tous les efashionColorIdOverride précédents pour ne pas
      // trainer un override obsolète d'une liaison antérieure.
      await tx.productColor.updateMany({
        where: { productId },
        data: { efashionProductId: null, efashionColorIdOverride: null },
      });

      for (const l of links) {
        // Décide de l'override d'id_couleur à poser sur la ProductColor.
        //
        // Contexte : le push de stock (lib/efashion-update.ts) utilise
        // `ProductColor.efashionColorIdOverride ?? Color.efashionColorId`.
        // Si le mapping global BJ diffère de l'id_couleur du produit eFashion
        // qu'on lie, il faut poser l'override, sinon eFashion recevra un
        // upsertProduitStock sur un id_couleur différent de celui déjà en
        // place → 2ᵉ entrée de stock créée → total affiché = ancien + nouveau.
        const globalId = globalEfashionColorIdByLocalId.get(l.localColorId) ?? null;
        const overrideNeeded =
          l.efashionColorId !== undefined &&
          l.efashionColorId !== null &&
          globalId !== null &&
          globalId !== l.efashionColorId
            ? l.efashionColorId
            : null;

        // eFashion ne gère qu'1 ligne par couleur et ne synchronise que les
        // variantes UNIT (cf. lib/efashion-publish.ts, lib/efashion-update.ts).
        // On pose donc l'efashionProductId UNIQUEMENT sur les ProductColor de
        // type UNIT. Les éventuelles variantes PACK partageant la même Color
        // restent à null pour éviter tout double-envoi à la sync.
        await tx.productColor.updateMany({
          where: { productId, colorId: l.localColorId, saleType: "UNIT" },
          data: {
            efashionProductId: l.efashionProductId,
            efashionColorIdOverride: overrideNeeded,
          },
        });

        // Met aussi l'efashionColorId sur la Color si pas déjà rempli — c'est
        // le mapping global BJ, on ne l'écrase jamais (les autres produits qui
        // l'utilisaient garderaient leur cohérence). Si un mapping global
        // existait déjà mais diffère, on a déjà posé l'override plus haut.
        if (l.efashionColorId) {
          await tx.color.updateMany({
            where: { id: l.localColorId, efashionColorId: null },
            data: { efashionColorId: l.efashionColorId },
          });
        }
      }
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    logger.info("[eFashion] Manual link saved", {
      productId,
      referenceBase,
      linkedColors: links.length,
    });

    // Sync auto post-liaison : on pousse immédiatement stock + prix + visibilité
    // vers eFashion pour aligner les 2 côtés sans étape manuelle. C'est aussi
    // cette sync qui crée automatiquement côté eFashion les couleurs locales
    // sans correspondance (BJ orphans) via duplicateWithNewColor — d'où le
    // suivi de `colorsCreatedCount` pour remonter le décompte à l'UI.
    // Best-effort — si la sync échoue, la liaison reste posée et on remonte un
    // warning non bloquant (l'admin peut relancer "Resync" depuis la fiche).
    let syncWarning: string | undefined;
    let autoCreatedOnEfashion = 0;
    try {
      const { efashionUpdateProductInPlace } = await import("@/lib/efashion-update");
      const res = await efashionUpdateProductInPlace(productId, { forceFullSync: true });
      autoCreatedOnEfashion = res.colorsCreatedCount ?? 0;
      if (!res.success) syncWarning = res.error;
    } catch (err) {
      syncWarning = err instanceof Error ? err.message : String(err);
      logger.warn("[eFashion] Post-link sync failed", { productId, error: err });
    }

    return {
      success: true,
      linked: links.length,
      autoCreatedOnEfashion,
      syncWarning,
    };
  } catch (err) {
    logger.warn("[eFashion] linkEfashionProductManually failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Délie un produit de toutes ses lignes eFashion (côté BDD seulement —
 * les lignes côté eFashion restent inchangées).
 */
export async function removeEfashionMatch(
  productId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          efashionReferenceBase: null,
          efashionLastSyncSnapshot: Prisma.DbNull,
          efashionLastRefreshedAt: null,
        },
      });
      await tx.productColor.updateMany({
        where: { productId },
        data: { efashionProductId: null },
      });
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Supprime DÉFINITIVEMENT une ligne produit-couleur côté eFashion. Hard delete
 * (cf. docs/efashion-api.md §5 : confirmé en mai 2026). Si cette ligne était
 * liée à une variante BJ, on délie aussi côté BDD.
 *
 * À utiliser depuis la modale de liaison quand l'admin choisit « la couleur
 * X chez eFashion n'a pas sa correspondance chez nous, supprimez-la chez
 * eux ». Confirmation côté UI obligatoire (useConfirm).
 */
export async function deleteEfashionProductLine(
  efashionProductId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const { efashionDeleteShootingProduct } = await import("@/lib/efashion-shootings");
    const res = await efashionDeleteShootingProduct(efashionProductId);
    if (!res.success) {
      return { success: false, error: res.message ?? "eFashion a refusé la suppression." };
    }

    // Si une variante BJ était liée à cet id, on délie côté BDD.
    await prisma.productColor.updateMany({
      where: { efashionProductId },
      data: { efashionProductId: null },
    });

    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    logger.info("[eFashion] Ligne supprimée côté eFashion", { efashionProductId });
    return { success: true };
  } catch (err) {
    logger.warn("[eFashion] deleteEfashionProductLine failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Crée une ProductColor UNIT locale à partir d'une ligne eFashion existante,
 * et la lie automatiquement (efashionProductId déjà posé). Utilisé depuis la
 * modale quand eFashion a une couleur en plus : « Créer cette variante chez
 * nous » → la couleur arrive directement liée dans le tableau de mapping.
 *
 * Stratégie :
 *  1. Récupère la ligne eFashion (nom couleur, id_couleur, prix, stock, déclinaison).
 *  2. Cherche une Color BJ existante : par efashionColorId, puis par nom normalisé.
 *     Si rien trouvé, en crée une nouvelle (hex placeholder #CCCCCC, à compléter).
 *  3. Choisit une Size par défaut : "TU" si elle existe, sinon la 1ʳᵉ existante.
 *  4. Démarkupe le prix eFashion pour obtenir un prix BJ approximatif.
 *  5. Crée la ProductColor UNIT (stock=0, weight=poids moyen des autres UNIT ou 0.01)
 *     avec efashionProductId déjà posé.
 *  6. Crée une VariantSize quantity=1 (placeholder).
 */
export async function createLocalVariantFromEfashionLine(
  productId: string,
  efashionProductId: number,
): Promise<{
  success: boolean;
  error?: string;
  productColorId?: string;
  createdColor?: boolean;
}> {
  try {
    await requireAdmin();

    const { efashionGetMe, efashionListByReferenceBaseExact } = await import(
      "@/lib/efashion-api"
    );
    const { loadEfashionMarkup } = await import("@/lib/efashion-pricing");
    const { generateSku } = await import("@/lib/sku");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        efashionReferenceBase: true,
        colors: {
          where: { saleType: "UNIT" },
          select: { weight: true },
        },
      },
    });
    if (!product) return { success: false, error: "Produit introuvable." };
    if (!product.efashionReferenceBase) {
      return {
        success: false,
        error: "Produit non lié à eFashion — finissez d'abord la liaison de base.",
      };
    }

    // 1. Récupère la ligne eFashion exacte — pagination obligatoire
    // (cf. lib/efashion-api.ts pour le détail). Pour les vieilles fiches
    // (A11, A21…), `reference` partiel + tri DESC les rejette en fin de
    // pagination ; sans boucle, on retombe sur l'erreur « plus visible »
    // alors que la ligne existe.
    const vendor = await efashionGetMe();
    const items = await efashionListByReferenceBaseExact({
      idVendeur: vendor.id_vendeur,
      referenceBase: product.efashionReferenceBase,
      premelFilter: "tous",
    });
    const efLine = items.find((it) => it.id_produit === efashionProductId);
    if (!efLine) {
      return {
        success: false,
        error: `La ligne eFashion ${efashionProductId} n'est plus visible (supprimée ou déplacée).`,
      };
    }

    // 2. Trouve ou crée la Color BJ
    let bjColor = await prisma.color.findFirst({
      where: { efashionColorId: efLine.id_couleur },
      select: { id: true, name: true },
    });
    let createdColor = false;
    if (!bjColor) {
      // Match par nom normalisé
      const targetNorm = efLine.couleur
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim();
      const allColors = await prisma.color.findMany({
        select: { id: true, name: true, efashionColorId: true },
      });
      const byName = allColors.find(
        (c) =>
          c.name
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .trim() === targetNorm,
      );
      if (byName) {
        bjColor = { id: byName.id, name: byName.name };
        // Lie l'efashionColorId pour la prochaine fois
        if (!byName.efashionColorId) {
          await prisma.color.update({
            where: { id: byName.id },
            data: { efashionColorId: efLine.id_couleur },
          });
        }
      } else {
        // Crée une nouvelle Color BJ — hex placeholder à compléter
        const created = await prisma.color.create({
          data: {
            name: efLine.couleur,
            hex: "#CCCCCC",
            efashionColorId: efLine.id_couleur,
          },
          select: { id: true, name: true },
        });
        bjColor = created;
        createdColor = true;
        logger.info("[eFashion] Color BJ créée à la volée depuis ligne eFashion", {
          colorId: bjColor.id,
          name: bjColor.name,
          efashionColorId: efLine.id_couleur,
        });
      }
    }

    // 3. Size par défaut : TU si elle existe, sinon la 1ʳᵉ
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
        error:
          "Aucune taille définie dans la bibliothèque BJ — créez d'abord une taille avant.",
      };
    }

    // 4. Démarkupe le prix : on inverse le markup appliqué à la sortie pour
    //    retrouver le prix BJ d'origine (approximation, l'arrondi est perdu).
    const markup = await loadEfashionMarkup();
    const bjPriceFromEfashion = unapplyMarkup(efLine.prix, markup);

    // 5. Poids : moyenne des autres UNIT, sinon 0.01
    const weight =
      product.colors.length > 0
        ? product.colors.reduce((sum, c) => sum + (c.weight || 0), 0) / product.colors.length
        : 0.01;

    // 6. Génère un SKU unique (index = nb de ProductColor existantes + 1)
    const totalVariants = await prisma.productColor.count({ where: { productId } });
    const sku = generateSku(product.reference, [bjColor.name], "UNIT", totalVariants + 1);

    // 7. Crée la ProductColor + VariantSize en transaction
    const newPc = await prisma.$transaction(async (tx) => {
      const pc = await tx.productColor.create({
        data: {
          productId,
          colorId: bjColor!.id,
          saleType: "UNIT",
          unitPrice: bjPriceFromEfashion,
          stock: 0,
          weight: Number.isFinite(weight) && weight > 0 ? weight : 0.01,
          isPrimary: false,
          disabled: false,
          sku,
          efashionProductId: efLine.id_produit,
          variantSizes: {
            create: [{ sizeId: size!.id, quantity: 1 }],
          },
        },
        select: { id: true },
      });
      // Reset snapshot pour forcer un full resync au prochain push
      await tx.product.update({
        where: { id: productId },
        data: { efashionLastSyncSnapshot: Prisma.DbNull },
      });
      return pc;
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    logger.info("[eFashion] ProductColor créée depuis ligne eFashion", {
      productId,
      productColorId: newPc.id,
      efashionProductId: efLine.id_produit,
      createdColor,
    });

    return { success: true, productColorId: newPc.id, createdColor };
  } catch (err) {
    logger.warn("[eFashion] createLocalVariantFromEfashionLine failed", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Démarkupe un prix eFashion pour retrouver le prix BJ d'origine (approximation).
 * Inverse de applyMarketplaceMarkup. L'arrondi est perdu mais on s'approche.
 */
function unapplyMarkup(
  efashionPrice: number,
  config: { type: "percent" | "fixed" | "multiplier"; value: number },
): number {
  if (config.value === 0) return Math.round(efashionPrice * 100) / 100;
  let base: number;
  switch (config.type) {
    case "percent":
      base = efashionPrice / (1 + config.value / 100);
      break;
    case "multiplier":
      base = config.value !== 0 ? efashionPrice / config.value : efashionPrice;
      break;
    case "fixed":
    default:
      base = efashionPrice - config.value;
      break;
  }
  return Math.max(0, Math.round(base * 100) / 100);
}

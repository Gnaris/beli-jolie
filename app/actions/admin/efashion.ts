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
  efashionListProducts,
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
  /** Couleur locale BJ pré-suggérée par matching insensible aux accents/case (peut être null). */
  suggestedLocalColorId: string | null;
}

export interface EfashionLinkPreview {
  productId: string;
  productName: string;
  reference: string;
  referenceBase: string;
  localColors: { id: string; name: string }[];
  candidates: EfashionLinkCandidate[];
  /** Total renvoyé par eFashion pour ce filtre (peut être > candidates.length si pagination). */
  totalOnEfashion: number;
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
        colors: {
          select: {
            id: true,
            color: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!product) return { success: false, error: "Produit introuvable." };

    // On déduit la référence à interroger : champ saisi par l'utilisatrice,
    // sinon référence déjà liée, sinon référence BJ (sans suffixe couleur).
    const referenceBase = (referenceBaseInput?.trim() ||
      product.efashionReferenceBase ||
      product.reference.split(/[-_]/)[0]).trim();

    if (!referenceBase) return { success: false, error: "Référence vide." };

    const vendor = await efashionGetMe();

    const list = await efashionListProducts({
      idVendeur: vendor.id_vendeur,
      take: 100,
      reference: referenceBase,
      premelFilter: "en_ligne",
    });

    // ⚠️ Le filtre `reference` côté eFashion est PARTIEL ("contient") — quand on
    // cherche "A21" on récupère A21, A210, A2100, A2101, etc. On fait un 2ᵉ
    // passe ici pour ne garder QUE les lignes dont le `reference_base`
    // correspond exactement (insensible à la casse et aux espaces) à ce que
    // l'utilisatrice cherche, sinon la liste est inutilisable.
    const needle = referenceBase.toLowerCase().trim();
    const filteredItems = list.items.filter(
      (it) => (it.reference_base ?? "").toLowerCase().trim() === needle,
    );

    // Un même Color peut apparaître sur plusieurs ProductColor (ex: une variante
    // UNIT + une variante PACK de la même couleur). Côté eFashion, 1 couleur
    // = 1 produit, donc on dédoublonne ici par Color.id — la liaison est posée
    // au niveau de la couleur BJ (via efashionColorId) et tous les ProductColor
    // qui partagent cette couleur recevront le même efashionProductId.
    const seenColorIds = new Set<string>();
    const localColors = product.colors
      .filter((pc) => pc.color)
      .filter((pc) => {
        if (seenColorIds.has(pc.color!.id)) return false;
        seenColorIds.add(pc.color!.id);
        return true;
      })
      .map((pc) => ({
        id: pc.color!.id,
        name: pc.color!.name,
        norm: normalizeColorName(pc.color!.name),
      }));

    const candidates: EfashionLinkCandidate[] = filteredItems.map(
      (it: EfashionProductListItem) => {
        const norm = normalizeColorName(it.couleur);
        const suggested = localColors.find((c) => c.norm === norm);
        return {
          efashionProductId: it.id_produit,
          reference: it.reference,
          efashionColorId: it.id_couleur,
          efashionColorName: it.couleur,
          visible: it.visible,
          supprimer: it.supprimer,
          stockValue: it.stock_value,
          nbPhotos: it.nb_photos,
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
        localColors: localColors.map((c) => ({ id: c.id, name: c.name })),
        candidates,
        // On expose le nombre exact (après filtre strict) plutôt que `list.total`
        // qui inclut les références partielles non pertinentes.
        totalOnEfashion: candidates.length,
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
): Promise<{ success: boolean; error?: string; linked?: number }> {
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

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, colors: { select: { id: true, colorId: true } } },
    });
    if (!product) return { success: false, error: "Produit introuvable." };

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
      await tx.productColor.updateMany({
        where: { productId },
        data: { efashionProductId: null },
      });

      for (const l of links) {
        // Si plusieurs ProductColor partagent la même Color (UNIT + PACK par ex.),
        // ils reçoivent tous le même efashionProductId — côté eFashion il n'y a
        // qu'1 ligne produit par couleur, donc toutes les variantes BJ de cette
        // couleur pointent vers la même ligne eFashion.
        await tx.productColor.updateMany({
          where: { productId, colorId: l.localColorId },
          data: { efashionProductId: l.efashionProductId },
        });

        // Met aussi l'efashionColorId sur la Color si pas déjà rempli
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
    return { success: true, linked: links.length };
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

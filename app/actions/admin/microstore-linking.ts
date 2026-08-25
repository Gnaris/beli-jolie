"use server";

/**
 * Server actions Microstore — liaison manuelle d'un produit BJ à un produit
 * Microstore existant (sans repush). Utilisé quand :
 *   - Le produit a été poussé côté Microstore par une autre voie
 *     (import CSV historique, saisie manuelle back-office, backfill à faire).
 *   - La cliente veut rattacher un produit BJ à sa fiche Microstore avant tout
 *     nouveau push, pour éviter un doublon côté marketplace.
 *
 * Flux :
 *   1. `searchMicrostoreProductsByRef(query)` — cherche par référence exacte via
 *      l'endpoint H5 `getMicrostoreGoodsByItemRef` (le seul disponible pour un
 *      lookup par référence externe côté acheteur). Renvoie 0 ou 1 candidat.
 *   2. `linkMicrostoreProductManually(bjProductId, microstoreProductId)` —
 *      fetch les SKUs Microstore via BOSS `/goods/get`, match par nom de
 *      couleur normalisé, persiste `Product.microstoreProductId` +
 *      `ProductColor.microstoreVariantId`.
 *   3. `unlinkMicrostoreProduct(bjProductId)` — reset les IDs (sans toucher à
 *      la fiche Microstore elle-même).
 */

import { requireAdmin } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import { microstoreGetGoods } from "@/lib/microstore-goods-crud";
import {
  getStoredPictureStation,
  getMicrostoreGoodsByItemRef,
} from "@/lib/microstore-picture-station";

interface ActionResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

async function humanize(err: unknown): Promise<string> {
  if (err instanceof MicrostoreSessionExpiredError) {
    return "Session Microstore expirée. Reconnectez-vous via QR code dans Paramètres → Microstore.";
  }
  if (err instanceof Error) return err.message;
  return "Erreur Microstore inconnue.";
}

export interface MicrostoreLinkCandidate {
  microstoreProductId: number;
  itemRef: string;
  name: string;
  colors: Array<{ colorId: number; colorName: string }>;
}

/**
 * Cherche un produit Microstore par référence exacte. Microstore n'expose pas
 * de recherche partielle côté H5 — soit la référence existe, soit non.
 * Renvoie un tableau (0 ou 1 élément) pour rester compatible avec une UI de
 * liste, au cas où une future API supporterait la recherche partielle.
 *
 * Utilise l'endpoint H5 `getMicrostoreGoodsByItemRef` qui demande la
 * `pictureStationKey` (séparée de la session BOSS, valide ~7 jours). Si la
 * key est absente ou expirée, on retourne un message clair au lieu d'un HTTP
 * 401 brut.
 */
export async function searchMicrostoreProductsByRef(
  query: string,
): Promise<ActionResult<MicrostoreLinkCandidate[]>> {
  await requireAdmin();
  const q = query.trim();
  if (!q) return { success: true, data: [] };
  try {
    const station = await getStoredPictureStation();
    if (!station) {
      return {
        success: false,
        error:
          "La Station de Transfert d'Images Microstore n'est pas configurée — nécessaire pour rechercher une fiche existante. Va dans Paramètres → Microstore → Station de Transfert et colle le lien de partage généré depuis ton back Microstore.",
      };
    }
    const goods = await getMicrostoreGoodsByItemRef(station.key, q).catch((err) => {
      // HTTP 401 sur H5 = pictureStationKey expirée (valide ~7 jours seulement).
      // On distingue ce cas d'une vraie erreur pour donner une piste actionnable.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
        throw new Error(
          "La Station de Transfert d'Images Microstore a expiré (valide ~7 jours). Regénère un nouveau lien de partage dans ton back Microstore, puis colle-le dans Paramètres → Microstore → Station de Transfert.",
        );
      }
      throw err;
    });
    if (!goods) return { success: true, data: [] };
    // Déduplique les SKUs par colorId pour n'afficher qu'une entrée par couleur.
    const seen = new Set<number>();
    const colors: Array<{ colorId: number; colorName: string }> = [];
    for (const s of goods.skus) {
      if (seen.has(s.colorId)) continue;
      seen.add(s.colorId);
      colors.push({ colorId: s.colorId, colorName: s.colorName });
    }
    return {
      success: true,
      data: [
        {
          microstoreProductId: goods.goodsId,
          itemRef: goods.itemRef,
          name: goods.name,
          colors,
        },
      ],
    };
  } catch (err) {
    logger.error("[Microstore link] search failed", { error: err, query: q });
    return { success: false, error: await humanize(err) };
  }
}

/**
 * Lie un produit BJ à une fiche Microstore existante. Match les couleurs BJ
 * (UNIT uniquement) par nom normalisé aux SKUs Microstore, puis persiste
 * `Product.microstoreProductId` + `ProductColor.microstoreVariantId`.
 *
 * Rapport : combien de variantes ont pu être liées, combien d'orphelines côté
 * BJ ou Microstore.
 */
export async function linkMicrostoreProductManually(
  bjProductId: string,
  microstoreProductId: number,
): Promise<
  ActionResult<{
    matched: number;
    orphansBj: string[];
    orphansMicrostore: string[];
  }>
> {
  await requireAdmin();
  try {
    const bj = await prisma.product.findUnique({
      where: { id: bjProductId },
      select: {
        id: true,
        reference: true,
        colors: {
          where: { saleType: "UNIT" },
          select: {
            id: true,
            microstoreVariantId: true,
            color: { select: { name: true } },
          },
        },
      },
    });
    if (!bj) return { success: false, error: "Produit BJ introuvable." };

    const info = await microstoreGetGoods(microstoreProductId);
    if (!info) {
      return {
        success: false,
        error: `Le produit Microstore #${microstoreProductId} est introuvable côté marketplace.`,
      };
    }

    // Index Microstore par colorName normalisé → skuId
    const msByColorName = new Map<string, number>();
    for (const s of info.sku) {
      msByColorName.set(normalize(s.color_name), Number(s.id));
    }
    const matchedSkuIds = new Set<number>();

    const updates: Array<{ pcId: string; msSkuId: number }> = [];
    const orphansBj: string[] = [];
    for (const pc of bj.colors) {
      if (!pc.color) continue;
      const key = normalize(pc.color.name);
      const msSkuId = msByColorName.get(key);
      if (msSkuId == null) {
        orphansBj.push(pc.color.name);
        continue;
      }
      matchedSkuIds.add(msSkuId);
      updates.push({ pcId: pc.id, msSkuId });
    }
    const orphansMicrostore: string[] = [];
    for (const s of info.sku) {
      if (!matchedSkuIds.has(Number(s.id))) {
        orphansMicrostore.push(s.color_name);
      }
    }

    // Persiste les IDs dans une transaction pour garantir la cohérence
    await prisma.$transaction([
      prisma.product.update({
        where: { id: bjProductId },
        data: {
          microstoreProductId,
          microstoreLastPushedAt: new Date(),
          microstoreSyncRequired: false,
        },
      }),
      ...updates.map((u) =>
        prisma.productColor.update({
          where: { id: u.pcId },
          data: { microstoreVariantId: u.msSkuId },
        }),
      ),
    ]);

    revalidatePath("/admin/produits");
    revalidateTag("products", "default");

    return {
      success: true,
      data: {
        matched: updates.length,
        orphansBj,
        orphansMicrostore,
      },
    };
  } catch (err) {
    logger.error("[Microstore link] link failed", {
      error: err,
      bjProductId,
      microstoreProductId,
    });
    return { success: false, error: await humanize(err) };
  }
}

/**
 * Délie un produit BJ de sa fiche Microstore — reset les IDs locaux sans
 * toucher à la fiche Microstore (utile pour préparer une re-création propre).
 */
export async function unlinkMicrostoreProduct(
  bjProductId: string,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    await prisma.$transaction([
      prisma.product.update({
        where: { id: bjProductId },
        data: {
          microstoreProductId: null,
          microstoreLastPushedAt: null,
          microstoreSyncRequired: false,
        },
      }),
      prisma.productColor.updateMany({
        where: { productId: bjProductId },
        data: { microstoreVariantId: null },
      }),
    ]);
    revalidatePath("/admin/produits");
    revalidateTag("products", "default");
    return { success: true };
  } catch (err) {
    logger.error("[Microstore link] unlink failed", { error: err, bjProductId });
    return { success: false, error: await humanize(err) };
  }
}

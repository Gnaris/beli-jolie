"use server";

/**
 * Server actions Microstore — push produits vers l'API `/goods/import_v1`.
 *
 * Fonctions exposées :
 *  - `pushProductToMicrostore(productId)` — bouton fiche produit
 *  - `bulkPushProductsToMicrostore(productIds[])` — bouton bulk sélection
 *  - `setProductMicrostoreEnabled(productId, enabled)` — toggle "activer pour ce produit"
 *  - `clearMicrostoreSyncRequired(productId)` — X d'annulation du badge Synchro nécessaire
 *
 * Pas de refresh / delete / upload photo : voir `lib/microstore-products.ts`.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  microstoreImportProducts,
  type MicrostoreImportResult,
} from "@/lib/microstore-products";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import { loadExportContext, loadExportProducts } from "@/lib/marketplace-excel/load-products";
import type { ExportProduct } from "@/lib/marketplace-excel/types";
import { getStoredPictureStation } from "@/lib/microstore-picture-station";
import { sendProductPhotosToMicrostore } from "@/app/actions/admin/microstore-picture-station";
import { requireCurrentTenant } from "@/lib/tenant";
import { tenantALS } from "@/lib/tenant-als";

interface ActionResult {
  success: boolean;
  error?: string;
  /** Pour le bulk : détail par produit. */
  results?: {
    productId: string;
    reference: string;
    success: boolean;
    error?: string;
  }[];
  /** Récap' agrégé (utile pour le toast). */
  totals?: { pushed: number; skipped: number; failed: number };
}

/**
 * Après un push réussi : reset du flag "Synchro nécessaire" + timestamp + snapshot.
 * Le snapshot sert au diff incrémental futur (pas exploité pour l'instant, mais
 * on le stocke pour ne pas avoir à re-migrer plus tard).
 */
async function markPushed(productIds: string[], payloadSnapshot: unknown): Promise<void> {
  if (productIds.length === 0) return;
  await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: {
      microstoreSyncRequired: false,
      microstoreLastPushedAt: new Date(),
      microstoreLastSyncSnapshot: payloadSnapshot as never,
    },
  });
}

async function humanizeError(err: unknown): Promise<string> {
  if (err instanceof MicrostoreSessionExpiredError) {
    // Diagnostic : distingue « clé absente en base » (jamais connecté ou
    // révoqué) de « clé présente mais rejetée par Microstore » (expirée).
    try {
      const { prisma } = await import("@/lib/prisma");
      const row = await prisma.siteConfig.findFirst({
        where: { key: "microstore_session_key" },
        select: { value: true },
      });
      if (!row?.value) {
        return "Microstore n'est pas connecté (aucune clé de session en base). Connectez-vous via QR code dans Paramètres › Marketplaces › Microstore.";
      }
    } catch {
      // fallback message générique
    }
    return "Session Microstore expirée. Reconnectez-vous via QR code dans Paramètres › Marketplaces › Microstore.";
  }
  if (err instanceof Error) return err.message;
  return "Erreur inconnue lors du push Microstore.";
}

/**
 * Push d'un seul produit vers Microstore. Utilisé par le bouton « Envoyer vers
 * Microstore » de la fiche produit.
 *
 * Ignoré silencieusement si :
 *  - Le produit est marqué `microstoreEnabled = false` (marketplace décochée).
 *  - Toutes les variantes sont des PACK (Microstore ne vend qu'à l'unité).
 */
export async function pushProductToMicrostore(productId: string): Promise<ActionResult> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      microstoreEnabled: true,
      countryIsoCode: true,
    },
  });
  if (!product) return { success: false, error: "Produit introuvable." };
  if (!product.microstoreEnabled) {
    return { success: false, error: "Microstore est désactivé pour ce produit." };
  }
  // Pays de fabrication obligatoire : sans lui, l'API Microstore écraserait
  // le pays existant côté marketplace par une chaîne vide.
  if (!product.countryIsoCode) {
    return {
      success: false,
      error: `Renseignez le pays de fabrication de « ${product.reference} » dans sa fiche avant de pousser vers Microstore.`,
    };
  }

  let ctx: Awaited<ReturnType<typeof loadExportContext>>;
  let exportProducts: ExportProduct[];
  try {
    [ctx, exportProducts] = await Promise.all([
      loadExportContext(),
      loadExportProducts([productId]),
    ]);
  } catch (err) {
    logger.error("[Microstore] failed to load export data", { error: err, productId });
    return { success: false, error: await humanizeError(err) };
  }

  const exportProduct = exportProducts[0];
  if (!exportProduct) return { success: false, error: "Produit introuvable après chargement." };

  let result: MicrostoreImportResult;
  try {
    result = await microstoreImportProducts([exportProduct], ctx);
  } catch (err) {
    logger.error("[Microstore] push failed", { error: err, productId });
    return { success: false, error: await humanizeError(err) };
  }

  if (!result.success) {
    return { success: false, error: result.error || "Microstore a refusé l'import." };
  }
  if (result.rowsSent === 0) {
    return {
      success: false,
      error: "Aucune variante à l'unité à envoyer (produit uniquement en PACK).",
    };
  }

  await markPushed([productId], { productsSent: result.productsSent, rowsSent: result.rowsSent });

  // CRITIQUE multi-tenant : capture le tenantId AVANT l'IIFE fire-and-forget,
  // sinon les jobs MicrostoreUploadJob sont créés sans tenantId → invisibles
  // dans le widget « Photos Microstore » (qui scope par tenant).
  const currentTenant = await requireCurrentTenant();

  // Chaîne l'envoi des photos via la Station de Transfert (fire-and-forget).
  // Si la Station n'est pas configurée, no-op silencieux.
  void tenantALS.run(currentTenant.id, async () => {
    const stored = await getStoredPictureStation();
    if (!stored) return;
    try {
      const psRes = await sendProductPhotosToMicrostore(product.reference);
      if (!psRes.success) {
        logger.warn("[Microstore] photos sync failed after fiche push", {
          productId,
          reference: product.reference,
          error: psRes.error,
        });
      }
    } catch (err) {
      logger.error("[Microstore] photos sync threw", { error: err, productId });
    }
  });

  revalidateTag("products", "default");
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);

  return { success: true, totals: { pushed: 1, skipped: 0, failed: 0 } };
}

/**
 * Push bulk d'une sélection de produits — un seul appel API `/goods/import_v1`
 * avec toutes les lignes agrégées. Produit désactivé ou 100% PACK = skip
 * silencieux, comptabilisé dans `totals.skipped`.
 */
export async function bulkPushProductsToMicrostore(
  productIds: string[],
): Promise<ActionResult> {
  await requireAdmin();

  if (productIds.length === 0) {
    return { success: true, totals: { pushed: 0, skipped: 0, failed: 0 }, results: [] };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      reference: true,
      microstoreEnabled: true,
      countryIsoCode: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const enabledIds = productIds.filter((id) => byId.get(id)?.microstoreEnabled);
  const skippedIds = productIds.filter((id) => !byId.get(id)?.microstoreEnabled);
  // Pays de fabrication obligatoire (sinon Microstore l'efface au push).
  const withCountryIds = enabledIds.filter((id) => byId.get(id)?.countryIsoCode);
  const missingCountryIds = enabledIds.filter((id) => !byId.get(id)?.countryIsoCode);

  if (withCountryIds.length === 0) {
    const results = productIds.map((id) => {
      const p = byId.get(id);
      if (!p?.microstoreEnabled) {
        return {
          productId: id,
          reference: p?.reference ?? "?",
          success: false,
          error: "Microstore désactivé pour ce produit.",
        };
      }
      return {
        productId: id,
        reference: p.reference,
        success: false,
        error: "Pays de fabrication manquant dans la fiche.",
      };
    });
    const skipped = skippedIds.length + missingCountryIds.length;
    return {
      success: skipped === productIds.length,
      totals: { pushed: 0, skipped, failed: 0 },
      results,
      error:
        missingCountryIds.length > 0
          ? `Pays de fabrication manquant sur ${missingCountryIds.length} produit(s). Renseignez-le dans la fiche avant de pousser vers Microstore.`
          : undefined,
    };
  }

  let ctx: Awaited<ReturnType<typeof loadExportContext>>;
  let exportProducts: ExportProduct[];
  try {
    [ctx, exportProducts] = await Promise.all([
      loadExportContext(),
      loadExportProducts(withCountryIds),
    ]);
  } catch (err) {
    logger.error("[Microstore] bulk push: failed to load export data", { error: err });
    return { success: false, error: await humanizeError(err) };
  }

  let result: MicrostoreImportResult;
  try {
    result = await microstoreImportProducts(exportProducts, ctx);
  } catch (err) {
    logger.error("[Microstore] bulk push failed", { error: err });
    return { success: false, error: await humanizeError(err) };
  }

  if (!result.success) {
    return { success: false, error: result.error || "Microstore a refusé l'import." };
  }

  // Note : l'API Microstore ne renvoie pas de statut par produit — soit tout
  // passe, soit tout échoue. On considère donc les produits ayant au moins une
  // ligne (couleur UNIT) comme poussés, et les autres (100% PACK) comme skip.
  const pushedIds = exportProducts
    .filter((p) => p.variants.some((v) => v.saleType === "UNIT" && v.colorNames.length > 0))
    .map((p) => p.id);
  const noUnitIds = withCountryIds.filter((id) => !pushedIds.includes(id));

  await markPushed(pushedIds, {
    productsSent: result.productsSent,
    rowsSent: result.rowsSent,
  });

  // Chaîne le bulk photos en fire-and-forget (mode « importation en masse »
  // Microstore : 1 seul POST pictureStations avec toutes les images). Si la
  // Station n'est pas configurée, no-op silencieux.
  const { bulkSendPhotosToMicrostore } = await import(
    "@/app/actions/admin/microstore-picture-station"
  );
  if (pushedIds.length > 0) {
    // CRITIQUE multi-tenant : capture le tenantId AVANT l'IIFE fire-and-forget,
    // sinon les jobs MicrostoreUploadJob sont créés sans tenantId → invisibles
    // dans le widget « Photos Microstore » (qui scope par tenant).
    const currentTenant = await requireCurrentTenant();
    void tenantALS.run(currentTenant.id, async () => {
      const stored = await getStoredPictureStation();
      if (!stored) return;
      try {
        const bulkRes = await bulkSendPhotosToMicrostore(pushedIds);
        if (!bulkRes.success) {
          logger.warn("[Microstore] bulk photos sync failed after fiche push", {
            productIds: pushedIds,
            error: bulkRes.error,
          });
        }
      } catch (err) {
        logger.error("[Microstore] bulk photos sync threw", { error: err });
      }
    });
  }

  revalidateTag("products", "default");
  revalidatePath("/admin/produits");

  const results = productIds.map((id) => {
    const p = byId.get(id);
    if (!p?.microstoreEnabled) {
      return {
        productId: id,
        reference: p?.reference ?? "?",
        success: false,
        error: "Microstore désactivé pour ce produit.",
      };
    }
    if (missingCountryIds.includes(id)) {
      return {
        productId: id,
        reference: p.reference,
        success: false,
        error: "Pays de fabrication manquant dans la fiche.",
      };
    }
    if (noUnitIds.includes(id)) {
      return {
        productId: id,
        reference: p.reference,
        success: false,
        error: "Aucune variante à l'unité (produit uniquement en PACK).",
      };
    }
    return { productId: id, reference: p.reference, success: true };
  });

  return {
    success: true,
    results,
    totals: {
      pushed: pushedIds.length,
      skipped: skippedIds.length + missingCountryIds.length + noUnitIds.length,
      failed: 0,
    },
  };
}

/**
 * Toggle `microstoreEnabled` sur un produit. Utilisé par la case
 * "Marketplace activée" de la fiche produit.
 */
export async function setProductMicrostoreEnabled(
  productId: string,
  enabled: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  const found = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!found) return { success: false, error: "Produit introuvable." };

  await prisma.product.update({
    where: { id: productId },
    data: {
      microstoreEnabled: enabled,
      // Réinitialise le flag Synchro nécessaire à la désactivation (rien à
      // pousser puisque la marketplace est décochée pour ce produit).
      ...(enabled ? {} : { microstoreSyncRequired: false }),
    },
  });

  revalidateTag("products", "default");
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  return { success: true };
}

/**
 * X d'annulation du badge « Synchro nécessaire » — la cliente indique qu'elle
 * accepte l'état actuel sans push (utile pour ignorer un changement mineur).
 */
export async function clearMicrostoreSyncRequired(
  productId: string,
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.product.update({
    where: { id: productId },
    data: { microstoreSyncRequired: false },
  });
  revalidateTag("products", "default");
  revalidatePath("/admin/produits");
  return { success: true };
}

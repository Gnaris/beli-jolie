"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsUpdateProductInPlace } from "@/lib/pfs-update";
import { pfsPublishProduct } from "@/lib/pfs-publish";
import { emitProductEvent } from "@/lib/product-events";
import { logger } from "@/lib/logger";
import {
  filterOptionsByEnabled,
  getProductMarketplaceEnabled,
  marketplaceDisabledMessage,
} from "@/lib/marketplace-enabled";
import { checkProductComplete } from "@/lib/product-publishability-check";
import { revalidateProductPublicPage } from "@/lib/product-url-server";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export interface MarketplacePublishOutcome {
  productId: string;
  reference: string;
  productName: string;
  pfs?:
    | { status: "ok"; mode: "create" | "update"; archived?: boolean }
    | { status: "disabled"; message: string }
    | { status: "error"; message: string };
  ankorstore?:
    // Ankorstore is callback-only — kickoff returns immediately. The widget
    // polls the local DB for the final outcome via /api/admin/ankorstore-operations.
    | { status: "queued"; mode: "create" | "update"; operationId: string }
    | { status: "ok"; mode: "create" | "update"; archived?: boolean }
    | { status: "disabled"; message: string }
    | { status: "error"; message: string };
  faire?:
    | { status: "ok"; mode: "create" | "update" }
    | { status: "disabled"; message: string }
    | { status: "error"; message: string };
  orderchamp?:
    | { status: "ok"; mode: "create" | "update" }
    | { status: "disabled"; message: string }
    | { status: "error"; message: string };
  microstore?:
    | { status: "ok"; mode: "create" | "update" }
    | { status: "disabled"; message: string }
    | { status: "error"; message: string };
}

export interface MarketplacePublishOptions {
  pfs: boolean;
  ankorstore?: boolean;
  faire?: boolean;
  orderchamp?: boolean;
  microstore?: boolean;
}

export async function publishProductToMarketplaces(
  productId: string,
  options: MarketplacePublishOptions,
): Promise<MarketplacePublishOutcome> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      pfsProductId: true,
      ankorsProductId: true,
      faireProductId: true,
      orderchampProductId: true,
    },
  });

  if (!product) {
    throw new Error("Produit introuvable.");
  }

  // Filtrage « marketplace activée pour ce produit ». On coupe silencieusement
  // les options des marketplaces désactivées et on remonte un status "disabled"
  // dans l'outcome pour que l'UI affiche "sauté (désactivée)".
  const enabled = await getProductMarketplaceEnabled(productId);
  const { filtered, skipped } = filterOptionsByEnabled(options, enabled);
  options = { ...options, ...filtered };

  const outcome: MarketplacePublishOutcome = {
    productId,
    reference: product.reference,
    productName: product.name,
  };
  for (const mp of skipped) {
    const message = marketplaceDisabledMessage(mp);
    if (mp === "pfs") outcome.pfs = { status: "disabled", message };
    if (mp === "ankorstore") outcome.ankorstore = { status: "disabled", message };
    if (mp === "faire") outcome.faire = { status: "disabled", message };
    if (mp === "orderchamp") outcome.orderchamp = { status: "disabled", message };
  }

  // Garde-fou complétude — on n'écrit sur AUCUN marketplace tant que le
  // produit n'est pas complet à 100 % (mêmes règles que la mise en ligne
  // boutique). Vaut pour la première création comme pour les mises à jour :
  // pousser une fiche partielle chez un marketplace = données fausses côté
  // vendeur (ex : composition vide chez Ankorstore).
  const completeness = await checkProductComplete(productId);
  if (!completeness.eligible) {
    if (options.pfs) outcome.pfs = { status: "error", message: completeness.message };
    if (options.ankorstore) outcome.ankorstore = { status: "error", message: completeness.message };
    if (options.faire) outcome.faire = { status: "error", message: completeness.message };
    if (options.orderchamp) outcome.orderchamp = { status: "error", message: completeness.message };
    logger.warn("[Marketplace Publish] Blocked — product incomplete", {
      productId,
      reasons: completeness.reasons,
    });
    return outcome;
  }

  if (options.pfs) {
    const { getCachedPfsEnabled } = await import("@/lib/cached-data");
    const pfsEnabled = await getCachedPfsEnabled();
    if (!pfsEnabled) {
      outcome.pfs = {
        status: "error",
        message: "Sync Paris Fashion Shop désactivée dans Paramètres.",
      };
    } else {
      try {
        if (product.pfsProductId) {
          // Produit déjà lié à une fiche PFS → PATCH (modification seulement).
          // ⚠️ PAS de fallback "publish" auto si le PATCH échoue : ça effacerait
          // le lien pfsProductId en base et retenterait un create sur la même
          // reference_code, ce que PFS refuse (« Référence non valide »).
          // Cas vu en réel sur A264 le 03/08 après un abort du fetch d'update.
          const res = await pfsUpdateProductInPlace(productId, undefined, { skipRevalidation: true });
          if (res.success) {
            outcome.pfs = { status: "ok", mode: "update", archived: res.archived };
          } else {
            logger.error("[Marketplace Publish] PFS update failed (no fallback)", {
              productId,
              error: res.error,
            });
            outcome.pfs = {
              status: "error",
              message:
                `Modification Paris Fashion Shop refusée : ${res.error ?? "erreur inconnue"}. ` +
                `Aucun produit n'a été recréé pour éviter un doublon ou un lien cassé. ` +
                `Vérifiez le contenu puis re-tentez.`,
            };
          }
        } else {
          const res = await pfsPublishProduct(productId, undefined, { skipRevalidation: true });
          if (res.success) {
            outcome.pfs = { status: "ok", mode: "create", archived: res.archived };
          } else {
            outcome.pfs = { status: "error", message: res.error };
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[Marketplace Publish] PFS unexpected error", { productId, error: message });
        outcome.pfs = { status: "error", message };
      }
    }
  }

  if (options.ankorstore) {
    const { getCachedAnkorstoreEnabled } = await import("@/lib/cached-data");
    const ankorstoreEnabled = await getCachedAnkorstoreEnabled();
    if (!ankorstoreEnabled) {
      outcome.ankorstore = {
        status: "error",
        message: "Sync Ankorstore désactivée dans Paramètres.",
      };
    } else {
      try {
        // Ankorstore back-office reverse-engineered — 100 % synchrone.
        // Un seul appel : publie (POST) si pas d'ankorsProductId, sinon met à jour (PUT).
        const mode: "create" | "update" = product.ankorsProductId ? "update" : "create";
        const { publishProductToAnkorstoreBo } = await import("@/app/actions/admin/ankorstore-bo");
        const res = await publishProductToAnkorstoreBo(productId);
        outcome.ankorstore = res.success
          ? { status: "ok", mode }
          : { status: "error", message: res.error ?? "Erreur inconnue" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[Marketplace Publish] Ankorstore unexpected error", {
          productId,
          error: message,
        });
        outcome.ankorstore = { status: "error", message };
      }
    }
  }

  if (options.faire) {
    const { getCachedFaireEnabled } = await import("@/lib/cached-data");
    const faireEnabled = await getCachedFaireEnabled();
    if (!faireEnabled) {
      outcome.faire = {
        status: "error",
        message: "Sync Faire désactivée dans Paramètres.",
      };
    } else {
      try {
        if (product.faireProductId) {
          // Produit déjà lié à une fiche Faire → PATCH (modification seulement).
          // ⚠️ PAS de fallback "publish" auto si le PATCH échoue : ça créerait
          // un doublon côté Faire (cas vu en réel sur F137). Si la modif
          // échoue, on remonte l'erreur claire pour que l'admin re-tente,
          // délie + relie manuellement, ou ajuste les données.
          const { faireUpdateProduct } = await import("@/lib/faire-update");
          const res = await faireUpdateProduct(productId);
          if (res.success) {
            outcome.faire = { status: "ok", mode: "update" };
          } else {
            logger.error("[Marketplace Publish] Faire update failed", {
              productId,
              error: res.error,
            });
            outcome.faire = {
              status: "error",
              message:
                `Modification Faire refusée : ${res.error ?? "erreur inconnue"}. ` +
                `Aucun produit n'a été recréé pour éviter un doublon. ` +
                `Vérifiez le contenu (caractères spéciaux, champs trop longs) puis re-tentez.`,
            };
          }
        } else {
          const { fairePublishProduct } = await import("@/lib/faire-publish");
          const res = await fairePublishProduct(productId);
          outcome.faire = res.success
            ? { status: "ok", mode: "create" }
            : { status: "error", message: res.error };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[Marketplace Publish] Faire unexpected error", { productId, error: message });
        outcome.faire = { status: "error", message };
      }
    }
  }

  if (options.orderchamp) {
    const { getCachedOrderchampEnabled } = await import("@/lib/cached-data");
    const orderchampEnabled = await getCachedOrderchampEnabled();
    if (!orderchampEnabled) {
      outcome.orderchamp = {
        status: "error",
        message: "Sync Orderchamp désactivée dans Paramètres.",
      };
    } else {
      try {
        if (product.orderchampProductId) {
          const { orderchampUpdateProduct } = await import("@/lib/orderchamp-update");
          const res = await orderchampUpdateProduct(productId);
          if (res.success) {
            outcome.orderchamp = { status: "ok", mode: "update" };
          } else {
            logger.error("[Marketplace Publish] Orderchamp update failed", { productId, error: res.error });
            outcome.orderchamp = {
              status: "error",
              message: `Modification Orderchamp refusée : ${res.error ?? "erreur inconnue"}. Aucun produit recréé.`,
            };
          }
        } else {
          const { orderchampPublishProduct } = await import("@/lib/orderchamp-publish");
          const res = await orderchampPublishProduct(productId);
          outcome.orderchamp = res.success
            ? { status: "ok", mode: "create" }
            : { status: "error", message: res.error };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[Marketplace Publish] Orderchamp unexpected error", { productId, error: message });
        outcome.orderchamp = { status: "error", message };
      }
    }
  }

  if (options.microstore) {
    const { getCachedMicrostoreEnabled } = await import("@/lib/cached-data");
    const microstoreEnabled = await getCachedMicrostoreEnabled();
    if (!microstoreEnabled) {
      outcome.microstore = {
        status: "disabled",
        message: "Microstore désactivée dans Paramètres.",
      };
    } else {
      try {
        const alreadyPushed = !!(await prisma.product.findUnique({
          where: { id: productId },
          select: { microstoreLastPushedAt: true },
        }))?.microstoreLastPushedAt;
        const { microstorePushProduct } = await import("@/lib/microstore-products");
        const { loadExportContext, loadExportProducts } = await import(
          "@/lib/marketplace-excel/load-products"
        );
        const [ctx, exportProducts] = await Promise.all([
          loadExportContext(),
          loadExportProducts([productId]),
        ]);
        const exportProduct = exportProducts[0];
        if (!exportProduct) {
          outcome.microstore = { status: "error", message: "Produit introuvable pour l'export Microstore." };
        } else {
          const res = await microstorePushProduct(exportProduct, ctx);
          if (res.success) {
            outcome.microstore = { status: "ok", mode: alreadyPushed ? "update" : "create" };
            await prisma.product.update({
              where: { id: productId },
              data: {
                microstoreLastPushedAt: new Date(),
                microstoreSyncRequired: false,
              },
            });
          } else {
            outcome.microstore = { status: "error", message: res.error ?? "Erreur inconnue" };
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[Marketplace Publish] Microstore unexpected error", { productId, error: message });
        outcome.microstore = { status: "error", message };
      }
    }
  }

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  await revalidateProductPublicPage(productId);
  revalidatePath("/produits");
  revalidateTag("products", "default");

  if (product.status === "ONLINE") {
    emitProductEvent({ type: "PRODUCT_UPDATED", productId });
  }

  return outcome;
}

export async function publishProductsToMarketplaces(
  productIds: string[],
  options: MarketplacePublishOptions,
): Promise<MarketplacePublishOutcome[]> {
  await requireAdmin();

  if (productIds.length === 0) return [];

  const results: MarketplacePublishOutcome[] = [];
  for (const id of productIds) {
    try {
      const res = await publishProductToMarketplaces(id, options);
      results.push(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Publish] Batch item failed", { productId: id, error: message });
      const fallback = await prisma.product.findUnique({
        where: { id },
        select: { reference: true, name: true },
      });
      results.push({
        productId: id,
        reference: fallback?.reference ?? "?",
        productName: fallback?.name ?? "Produit introuvable",
        pfs: options.pfs ? { status: "error", message } : undefined,
        ankorstore: options.ankorstore ? { status: "error", message } : undefined,
        faire: options.faire ? { status: "error", message } : undefined,
        orderchamp: options.orderchamp ? { status: "error", message } : undefined,
        microstore: options.microstore ? { status: "error", message } : undefined,
      });
    }
  }

  return results;
}

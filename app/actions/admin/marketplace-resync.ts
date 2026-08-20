"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsUpdateProductInPlace } from "@/lib/pfs-update";
import { emitProductEvent } from "@/lib/product-events";
import { logger } from "@/lib/logger";
import type { MarketplacePublishOutcome } from "./marketplace-publish";
import { isMarketplaceInMaintenance, marketplaceMaintenanceMessage } from "@/lib/platform-config";
import { checkProductComplete } from "@/lib/product-publishability-check";
import { revalidateProductPublicPage } from "@/lib/product-url-server";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export async function resyncProductOnPfs(
  productId: string,
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
    },
  });

  if (!product) {
    throw new Error("Produit introuvable.");
  }

  const outcome: MarketplacePublishOutcome = {
    productId,
    reference: product.reference,
    productName: product.name,
  };

  if (!product.pfsProductId) {
    outcome.pfs = {
      status: "error",
      message: "Produit non publié sur Paris Fashion Shop.",
    };
    return outcome;
  }

  if (await isMarketplaceInMaintenance("pfs")) {
    outcome.pfs = { status: "error", message: marketplaceMaintenanceMessage("pfs") };
    return outcome;
  }

  const completeness = await checkProductComplete(productId);
  if (!completeness.eligible) {
    outcome.pfs = { status: "error", message: completeness.message };
    logger.warn("[PFS Resync] Blocked — product incomplete", {
      productId,
      reasons: completeness.reasons,
    });
    return outcome;
  }

  try {
    const res = await pfsUpdateProductInPlace(productId, undefined, {
      skipRevalidation: true,
      forceFullSync: true,
    });
    if (res.success) {
      outcome.pfs = { status: "ok", mode: "update", archived: res.archived };
    } else {
      outcome.pfs = { status: "error", message: res.error };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Resync] unexpected error", { productId, error: message });
    outcome.pfs = { status: "error", message };
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

export async function resyncProductOnAnkorstore(
  productId: string,
): Promise<MarketplacePublishOutcome> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      ankorsProductId: true,
    },
  });

  if (!product) {
    throw new Error("Produit introuvable.");
  }

  const outcome: MarketplacePublishOutcome = {
    productId,
    reference: product.reference,
    productName: product.name,
  };

  if (!product.ankorsProductId) {
    outcome.ankorstore = {
      status: "error",
      message: "Produit non publié sur Ankorstore.",
    };
    return outcome;
  }

  if (await isMarketplaceInMaintenance("ankorstore")) {
    outcome.ankorstore = { status: "error", message: marketplaceMaintenanceMessage("ankorstore") };
    return outcome;
  }

  const { getCachedAnkorstoreEnabled } = await import("@/lib/cached-data");
  const ankorstoreEnabled = await getCachedAnkorstoreEnabled();
  if (!ankorstoreEnabled) {
    outcome.ankorstore = {
      status: "error",
      message: "Sync Ankorstore désactivée dans Paramètres.",
    };
    return outcome;
  }

  const completeness = await checkProductComplete(productId);
  if (!completeness.eligible) {
    outcome.ankorstore = { status: "error", message: completeness.message };
    logger.warn("[Ankorstore Resync] Blocked — product incomplete", {
      productId,
      reasons: completeness.reasons,
    });
    return outcome;
  }

  try {
    // Back-office reverse : le "resync forcé" = re-envoyer l'état BJ chez Ankor
    // (POST si pas de lien INT, PUT sinon). Synchrone.
    const { publishProductToAnkorstoreBo } = await import("@/app/actions/admin/ankorstore-bo");
    const res = await publishProductToAnkorstoreBo(productId);
    outcome.ankorstore = res.success
      ? { status: "ok", mode: "update" }
      : { status: "error", message: res.error ?? "Erreur inconnue" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Resync] unexpected error", { productId, error: message });
    outcome.ankorstore = { status: "error", message };
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

// ─── Orderchamp ─────────────────────────────────────────────────────────────

export async function resyncProductOnOrderchamp(
  productId: string,
): Promise<MarketplacePublishOutcome> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      orderchampProductId: true,
    },
  });

  if (!product) throw new Error("Produit introuvable.");

  const outcome: MarketplacePublishOutcome = {
    productId,
    reference: product.reference,
    productName: product.name,
  };

  if (!product.orderchampProductId) {
    outcome.orderchamp = { status: "error", message: "Produit non publié sur Orderchamp." };
    return outcome;
  }

  if (await isMarketplaceInMaintenance("orderchamp")) {
    outcome.orderchamp = { status: "error", message: marketplaceMaintenanceMessage("orderchamp") };
    return outcome;
  }

  const { getCachedOrderchampEnabled } = await import("@/lib/cached-data");
  const orderchampEnabled = await getCachedOrderchampEnabled();
  if (!orderchampEnabled) {
    outcome.orderchamp = { status: "error", message: "Sync Orderchamp désactivée dans Paramètres." };
    return outcome;
  }

  const completeness = await checkProductComplete(productId);
  if (!completeness.eligible) {
    outcome.orderchamp = { status: "error", message: completeness.message };
    logger.warn("[Orderchamp Resync] Blocked — product incomplete", { productId, reasons: completeness.reasons });
    return outcome;
  }

  try {
    const { orderchampUpdateProduct } = await import("@/lib/orderchamp-update");
    const res = await orderchampUpdateProduct(productId, { forceFullSync: true });
    outcome.orderchamp = res.success
      ? { status: "ok", mode: "update" }
      : { status: "error", message: res.error ?? "Erreur inconnue" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Orderchamp Resync] unexpected error", { productId, error: message });
    outcome.orderchamp = { status: "error", message };
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

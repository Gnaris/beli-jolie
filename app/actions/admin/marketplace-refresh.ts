"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsRefreshProduct } from "@/lib/pfs-refresh";
import { emitProductEvent } from "@/lib/product-events";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export interface MarketplaceRefreshOutcome {
  productId: string;
  reference: string;
  productName: string;
  local: { status: "ok" } | { status: "skipped" };
  pfs?:
    | { status: "ok"; archived: boolean }
    | { status: "not_found"; message: string }
    | { status: "error"; message: string };
}

export interface MarketplaceRefreshOptions {
  local: boolean; // Bump lastRefreshedAt (makes product "Nouveauté" again)
  pfs: boolean; // Re-push to PFS (create new + soft-delete old)
}

async function refreshLocal(productId: string): Promise<void> {
  await prisma.product.update({
    where: { id: productId },
    data: { lastRefreshedAt: new Date() },
  });
}

export async function refreshProductOnMarketplaces(
  productId: string,
  options: MarketplaceRefreshOptions,
): Promise<MarketplaceRefreshOutcome> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, reference: true, name: true, status: true },
  });

  if (!product) {
    throw new Error("Produit introuvable.");
  }

  const outcome: MarketplaceRefreshOutcome = {
    productId,
    reference: product.reference,
    productName: product.name,
    local: options.local ? { status: "ok" } : { status: "skipped" },
  };

  if (options.local) {
    await refreshLocal(productId);
  }

  if (options.pfs) {
    try {
      const res = await pfsRefreshProduct(productId, undefined, { skipRevalidation: true });
      if (res.success) {
        outcome.pfs = { status: "ok", archived: res.archived };
      } else if (res.reason === "not_found") {
        outcome.pfs = { status: "not_found", message: res.error };
      } else {
        outcome.pfs = { status: "error", message: res.error };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Refresh] PFS unexpected error", { productId, error: message });
      outcome.pfs = { status: "error", message };
    }
  }

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidatePath(`/produits/${productId}`);
  revalidatePath("/produits");
  revalidateTag("products", "default");

  if (product.status === "ONLINE") {
    emitProductEvent({ type: "PRODUCT_UPDATED", productId });
  }

  return outcome;
}

export async function refreshProductsOnMarketplaces(
  productIds: string[],
  options: MarketplaceRefreshOptions,
): Promise<MarketplaceRefreshOutcome[]> {
  await requireAdmin();

  if (productIds.length === 0) return [];

  const results: MarketplaceRefreshOutcome[] = [];
  for (const id of productIds) {
    try {
      const res = await refreshProductOnMarketplaces(id, options);
      results.push(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Refresh] Batch item failed", { productId: id, error: message });
      const fallback = await prisma.product.findUnique({
        where: { id },
        select: { reference: true, name: true },
      });
      results.push({
        productId: id,
        reference: fallback?.reference ?? "?",
        productName: fallback?.name ?? "Produit introuvable",
        local: { status: "skipped" },
        pfs: options.pfs ? { status: "error", message } : undefined,
      });
    }
  }

  return results;
}

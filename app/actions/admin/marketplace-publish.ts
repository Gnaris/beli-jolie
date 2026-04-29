"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsRefreshProduct } from "@/lib/pfs-refresh";
import { pfsPublishProduct } from "@/lib/pfs-publish";
import { ankorstoreRefreshProduct } from "@/lib/ankorstore-refresh";
import { ankorstorePublishProduct } from "@/lib/ankorstore-publish";
import { emitProductEvent } from "@/lib/product-events";
import { logger } from "@/lib/logger";

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
    | { status: "ok"; mode: "create" | "refresh"; archived?: boolean }
    | { status: "error"; message: string };
  ankorstore?:
    | { status: "ok"; mode: "create" | "refresh"; opId?: string; warning: string }
    | { status: "error"; message: string };
}

export interface MarketplacePublishOptions {
  pfs: boolean;
  ankorstore: boolean;
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

  if (options.pfs) {
    try {
      if (product.pfsProductId) {
        // Déjà publié sur PFS → refresh (crée nouveau + remplace ID)
        const res = await pfsRefreshProduct(productId, undefined, { skipRevalidation: true });
        if (res.success) {
          outcome.pfs = { status: "ok", mode: "refresh", archived: res.archived };
        } else if (res.reason === "not_found") {
          // Cas limite : on avait un ID, mais PFS ne le trouve plus. On retombe en publish.
          await prisma.product.update({
            where: { id: productId },
            data: { pfsProductId: null },
          });
          const pubRes = await pfsPublishProduct(productId, undefined, { skipRevalidation: true });
          if (pubRes.success) {
            outcome.pfs = { status: "ok", mode: "create", archived: pubRes.archived };
          } else {
            outcome.pfs = { status: "error", message: pubRes.error };
          }
        } else {
          outcome.pfs = { status: "error", message: res.error };
        }
      } else {
        // Première publication
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

  if (options.ankorstore) {
    try {
      if (product.ankorsProductId) {
        // Déjà publié → refresh
        const res = await ankorstoreRefreshProduct(productId);
        if (res.success) {
          outcome.ankorstore = {
            status: "ok",
            mode: "refresh",
            opId: res.opId,
            warning: res.warning,
          };
        } else if (res.reason === "not_found") {
          // ID stale → on retombe en publish
          await prisma.product.update({
            where: { id: productId },
            data: { ankorsProductId: null },
          });
          const pubRes = await ankorstorePublishProduct(productId);
          if (pubRes.success) {
            outcome.ankorstore = {
              status: "ok",
              mode: "create",
              opId: pubRes.opId,
              warning: pubRes.warning,
            };
          } else {
            outcome.ankorstore = { status: "error", message: pubRes.error };
          }
        } else {
          outcome.ankorstore = { status: "error", message: res.error };
        }
      } else {
        // Première publication
        const res = await ankorstorePublishProduct(productId);
        if (res.success) {
          outcome.ankorstore = {
            status: "ok",
            mode: "create",
            opId: res.opId,
            warning: res.warning,
          };
        } else {
          outcome.ankorstore = { status: "error", message: res.error };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Publish] Ankorstore unexpected error", { productId, error: message });
      outcome.ankorstore = { status: "error", message };
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
      });
    }
  }

  return results;
}

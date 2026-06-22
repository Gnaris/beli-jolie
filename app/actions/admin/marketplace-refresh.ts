"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsRefreshProduct } from "@/lib/pfs-refresh";
import { emitProductEvent } from "@/lib/product-events";
import { logger } from "@/lib/logger";
import {
  getRefreshIneligibilityReason,
  labelForIneligibility,
} from "@/lib/refresh-eligibility";

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
  ankorstore?:
    // Ankorstore is callback-only — kickoff returns immediately.
    | { status: "queued"; operationId: string }
    | { status: "not_found"; message: string }
    | { status: "error"; message: string };
  faire?:
    | { status: "ok" }
    | { status: "not_found"; message: string }
    | { status: "error"; message: string };
}

export interface MarketplaceRefreshOptions {
  local: boolean; // Bump lastRefreshedAt (makes product "Nouveauté" again)
  pfs: boolean; // Re-push to PFS (create new + soft-delete old)
  ankorstore?: boolean; // Re-push to Ankorstore (Phase 4)
  efashion?: boolean; // Re-push to eFashion Paris (Lot 3 = update / Lot 5 = refresh complet)
  faire?: boolean; // Re-push to Faire (3.B)
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
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      isIncomplete: true,
      locked: true,
      pfsProductId: true,
    },
  });

  if (!product) {
    throw new Error("Produit introuvable.");
  }

  // Garde-fou statut : un produit Archivé / Hors ligne / Brouillon / SYNCING /
  // Verrouillé ne peut pas être rafraîchi. Vérif locale pour défense en
  // profondeur même si l'UI a déjà filtré côté client.
  const ineligibility = getRefreshIneligibilityReason({
    status: product.status,
    isIncomplete: product.isIncomplete,
    wasImported: !!product.pfsProductId,
    locked: product.locked,
  });
  if (ineligibility) {
    throw new Error(
      `Impossible de rafraîchir ce produit : ${labelForIneligibility(ineligibility)}.`,
    );
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
        const { ankorstoreKickoffRefresh } = await import("@/lib/ankorstore-refresh");
        const res = await ankorstoreKickoffRefresh(productId);
        if (res.success) {
          outcome.ankorstore = { status: "queued", operationId: res.operationId };
        } else if (res.reason === "not_found") {
          outcome.ankorstore = { status: "not_found", message: res.error };
        } else {
          outcome.ankorstore = { status: "error", message: res.error };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[Marketplace Refresh] Ankorstore unexpected error", {
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
        const { faireRefreshProduct } = await import("@/lib/faire-refresh");
        const res = await faireRefreshProduct(productId);
        if (res.success) {
          outcome.faire = { status: "ok" };
        } else {
          outcome.faire = { status: "error", message: res.error };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[Marketplace Refresh] Faire unexpected error", { productId, error: message });
        outcome.faire = { status: "error", message };
      }
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

// ─── Garde-fou : produits déjà rafraîchis récemment ────────────────────────

export interface RecentlyRefreshedProduct {
  productId: string;
  reference: string;
  productName: string;
  lastRefreshedAt: string; // ISO — sérialisable côté client
  daysAgo: number;
}

export interface RecentlyRefreshedCheck {
  enabled: boolean;
  thresholdDays: number;
  items: RecentlyRefreshedProduct[];
}

/**
 * Filtre la liste des produits demandés et retourne ceux qui ont été
 * rafraîchis il y a strictement moins de `refresh_warning_days` jours.
 * Si la config est désactivée → renvoie `enabled: false` et `items: []`.
 *
 * Utilisé par la modale d'avertissement avant de lancer un refresh manuel.
 */
export async function getRecentlyRefreshedProducts(
  productIds: string[],
): Promise<RecentlyRefreshedCheck> {
  await requireAdmin();

  const [enabledRow, daysRow] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "refresh_warning_enabled" } }),
    prisma.siteConfig.findUnique({ where: { key: "refresh_warning_days" } }),
  ]);

  const enabled = enabledRow?.value === "true";
  const parsedDays = daysRow ? parseInt(daysRow.value, 10) : NaN;
  const thresholdDays = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 7;

  if (!enabled || productIds.length === 0) {
    return { enabled, thresholdDays, items: [] };
  }

  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      lastRefreshedAt: { gt: cutoff },
    },
    select: { id: true, reference: true, name: true, lastRefreshedAt: true },
    orderBy: { lastRefreshedAt: "desc" },
  });

  const now = Date.now();
  const items: RecentlyRefreshedProduct[] = products.map((p) => {
    const ts = p.lastRefreshedAt!.getTime();
    const daysAgo = Math.floor((now - ts) / (24 * 60 * 60 * 1000));
    return {
      productId: p.id,
      reference: p.reference,
      productName: p.name,
      lastRefreshedAt: p.lastRefreshedAt!.toISOString(),
      daysAgo,
    };
  });

  return { enabled, thresholdDays, items };
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
        ankorstore: options.ankorstore ? { status: "error", message } : undefined,
        faire: options.faire ? { status: "error", message } : undefined,
      });
    }
  }

  return results;
}

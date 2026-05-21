"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pfsDeleteProduct } from "@/lib/pfs-api-write";
import { ankorstoreKickoffStandaloneDelete } from "@/lib/ankorstore-delete";
import { efashionDeleteShootingProduct } from "@/lib/efashion-shootings";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export interface PfsDeleteOutcome {
  pfsProductId: string;
  reference: string;
  status: "ok" | "error";
  message?: string;
}

/**
 * Soft-delete sur PFS pour une liste de produits (par leur pfsProductId).
 * Utilisé quand l'admin supprime des produits de la boutique et veut
 * aussi les retirer de Paris Fashion Shop.
 */
export async function deleteProductsOnPfs(
  items: { pfsProductId: string; reference: string }[],
): Promise<PfsDeleteOutcome[]> {
  await requireAdmin();
  const results: PfsDeleteOutcome[] = [];
  for (const item of items) {
    try {
      await pfsDeleteProduct(item.pfsProductId);
      results.push({ pfsProductId: item.pfsProductId, reference: item.reference, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Delete] PFS delete failed", {
        pfsProductId: item.pfsProductId,
        reference: item.reference,
        error: message,
      });
      results.push({
        pfsProductId: item.pfsProductId,
        reference: item.reference,
        status: "error",
        message,
      });
    }
  }
  return results;
}

export interface AnkorstoreDeleteOutcome {
  ankorsProductId: string;
  reference: string;
  // "ok" = delete operation accepted by Ankorstore (will be confirmed via webhook later)
  // "error" = kickoff failed locally (no Ankorstore op was created)
  status: "ok" | "error";
  operationId?: string;
  message?: string;
}

/**
 * Lance la suppression sur Ankorstore pour une liste de produits.
 *
 * **Mode callback-only** : pour chaque item, on appelle le kickoff
 * (`ankorstoreKickoffStandaloneDelete`) qui demande à Ankorstore de supprimer
 * le produit et retourne immédiatement un `operationId`. Le résultat final
 * arrive plus tard via webhook (`/api/webhooks/ankorstore`).
 *
 * Le statut "ok" ici signifie « delete demandé », pas « delete confirmé ».
 *
 * Il faut que le produit local existe encore en BDD au moment de l'appel
 * pour pouvoir ouvrir une row `AnkorstoreOperation` (foreign key). Appelle
 * donc cette fonction AVANT de supprimer le produit côté local.
 */
export async function deleteProductsOnAnkorstore(
  items: { ankorsProductId: string; reference: string }[],
): Promise<AnkorstoreDeleteOutcome[]> {
  await requireAdmin();
  const results: AnkorstoreDeleteOutcome[] = [];

  // Resolve productId from ankorsProductId for each item (FK on AnkorstoreOperation)
  const ankorsIds = items.map((i) => i.ankorsProductId);
  const products = ankorsIds.length
    ? await prisma.product.findMany({
        where: { ankorsProductId: { in: ankorsIds } },
        select: { id: true, ankorsProductId: true },
      })
    : [];
  const productIdByAnkors = new Map(products.map((p) => [p.ankorsProductId!, p.id]));

  for (const item of items) {
    const productId = productIdByAnkors.get(item.ankorsProductId);
    if (!productId) {
      results.push({
        ankorsProductId: item.ankorsProductId,
        reference: item.reference,
        status: "error",
        message: "Produit local introuvable (ankorsProductId orphelin)",
      });
      continue;
    }

    try {
      const res = await ankorstoreKickoffStandaloneDelete({
        productId,
        reference: item.reference,
        ankorsProductId: item.ankorsProductId,
      });
      if (res.success) {
        results.push({
          ankorsProductId: item.ankorsProductId,
          reference: item.reference,
          status: "ok",
          operationId: res.operationId,
        });
      } else {
        results.push({
          ankorsProductId: item.ankorsProductId,
          reference: item.reference,
          status: "error",
          message: res.error,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Delete] Ankorstore kickoff failed", {
        ankorsProductId: item.ankorsProductId,
        reference: item.reference,
        error: message,
      });
      results.push({
        ankorsProductId: item.ankorsProductId,
        reference: item.reference,
        status: "error",
        message,
      });
    }
  }
  return results;
}

// ─── eFashion Paris (Lot 5) ─────────────────────────────────────────────────

export interface EfashionDeleteOutcome {
  efashionProductId: number;
  reference: string;
  status: "ok" | "error";
  message?: string;
}

/**
 * Suppression synchrone d'une liste de produits-couleurs eFashion.
 * Appelle `POST /shootings/product/{id}/delete` pour chacun.
 * À appeler AVANT la suppression locale (mais peu critique côté FK puisque
 * `ProductColor.efashionProductId` n'a pas de contrainte).
 */
export async function deleteProductsOnEfashion(
  items: Array<{ efashionProductId: number; reference: string }>,
): Promise<EfashionDeleteOutcome[]> {
  await requireAdmin();
  const results: EfashionDeleteOutcome[] = [];
  for (const item of items) {
    try {
      await efashionDeleteShootingProduct(item.efashionProductId);
      results.push({
        efashionProductId: item.efashionProductId,
        reference: item.reference,
        status: "ok",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Delete] eFashion delete failed", {
        efashionProductId: item.efashionProductId,
        reference: item.reference,
        error: message,
      });
      results.push({
        efashionProductId: item.efashionProductId,
        reference: item.reference,
        status: "error",
        message,
      });
    }
  }
  return results;
}

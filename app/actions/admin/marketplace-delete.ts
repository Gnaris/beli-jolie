"use server";

import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { pfsDeleteProduct } from "@/lib/pfs-api-write";
import { efashionDeleteShootingProduct } from "@/lib/efashion-shootings";
import { faireHardDeleteProduct } from "@/lib/faire-delete";
import { orderchampHardDeleteProduct } from "@/lib/orderchamp-delete";
import {
  getCachedAnkorstoreEnabled,
  getCachedEfashionEnabled,
  getCachedFaireEnabled,
  getCachedOrderchampEnabled,
} from "@/lib/cached-data";
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

  // Kill switch : si Ankorstore est désactivé dans Paramètres > Marketplaces,
  // on n'envoie RIEN. Sinon, mettre Ankorstore en pause ne suffit pas à
  // empêcher la propagation des suppressions locales — la cliente croit
  // avoir mis en pause mais ses produits disparaissent quand même.
  const ankorstoreEnabled = await getCachedAnkorstoreEnabled();
  if (!ankorstoreEnabled) {
    logger.info("[Marketplace Delete] Ankorstore disabled, skipping all deletes", {
      itemCount: items.length,
    });
    return items.map((item) => ({
      ankorsProductId: item.ankorsProductId,
      reference: item.reference,
      status: "error" as const,
      message: "Ankorstore désactivé dans les paramètres — aucune suppression envoyée.",
    }));
  }

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
      // Reverse back-office : archive synchrone (mass-action action=archive).
      const { deleteProductFromAnkorstoreBo } = await import(
        "@/app/actions/admin/ankorstore-bo"
      );
      const res = await deleteProductFromAnkorstoreBo(productId);
      if (res.success) {
        results.push({
          ankorsProductId: item.ankorsProductId,
          reference: item.reference,
          status: "ok",
        });
      } else {
        results.push({
          ankorsProductId: item.ankorsProductId,
          reference: item.reference,
          status: "error",
          message: res.error ?? "Erreur inconnue",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Delete] Ankorstore delete failed", {
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

  // Kill switch : si eFashion est désactivé dans Paramètres > Marketplaces,
  // on n'envoie RIEN (cohérent avec Ankorstore).
  const efashionEnabled = await getCachedEfashionEnabled();
  if (!efashionEnabled) {
    logger.info("[Marketplace Delete] eFashion disabled, skipping all deletes", {
      itemCount: items.length,
    });
    return items.map((item) => ({
      efashionProductId: item.efashionProductId,
      reference: item.reference,
      status: "error" as const,
      message: "eFashion désactivé dans les paramètres — aucune suppression envoyée.",
    }));
  }

  const results: EfashionDeleteOutcome[] = [];
  for (const item of items) {
    try {
      const res = await efashionDeleteShootingProduct(item.efashionProductId);
      if (res.success) {
        results.push({
          efashionProductId: item.efashionProductId,
          reference: item.reference,
          status: "ok",
        });
      } else {
        logger.warn("[Marketplace Delete] eFashion delete refused", {
          efashionProductId: item.efashionProductId,
          reference: item.reference,
          message: res.message,
        });
        results.push({
          efashionProductId: item.efashionProductId,
          reference: item.reference,
          status: "error",
          message: res.message ?? "eFashion a refusé la suppression.",
        });
      }
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

// ─── Faire ──────────────────────────────────────────────────────────────────

export interface FaireDeleteOutcome {
  faireProductId: string;
  reference: string;
  status: "ok" | "error";
  /** True quand Faire renvoie 404 — la fiche distante n'existait déjà plus. */
  alreadyGone?: boolean;
  message?: string;
}

/**
 * Suppression définitive (hard delete) d'une liste de produits côté Faire.
 *
 * Faire renvoie 404 si l'ID n'existe déjà plus — on traite comme un succès
 * idempotent. Les mappings locaux (`Product.faireProductId`, `ProductColor.faireVariantId`)
 * sont nettoyés pour les opérations OK afin que l'UI reflète l'état réel,
 * même si le produit local doit ensuite être supprimé.
 */
export async function deleteProductsOnFaire(
  items: Array<{ faireProductId: string; reference: string }>,
): Promise<FaireDeleteOutcome[]> {
  await requireAdmin();

  const faireEnabled = await getCachedFaireEnabled();
  if (!faireEnabled) {
    logger.info("[Marketplace Delete] Faire disabled, skipping all deletes", {
      itemCount: items.length,
    });
    return items.map((item) => ({
      faireProductId: item.faireProductId,
      reference: item.reference,
      status: "error" as const,
      message: "Faire désactivé dans les paramètres — aucune suppression envoyée.",
    }));
  }

  const results: FaireDeleteOutcome[] = [];
  for (const item of items) {
    try {
      const res = await faireHardDeleteProduct(item.faireProductId);
      if (res.success) {
        // Best-effort cleanup local. Si la fiche locale a déjà disparu (cas du
        // bulk delete qui appelle cette fonction APRÈS prisma.product.delete),
        // l'updateMany ne touche rien — pas grave.
        await prisma.product
          .updateMany({
            where: { faireProductId: item.faireProductId },
            data: {
              faireProductId: null,
              faireLastSyncSnapshot: Prisma.DbNull,
              faireSyncRequired: false,
            },
          })
          .catch(() => {});
        results.push({
          faireProductId: item.faireProductId,
          reference: item.reference,
          status: "ok",
          alreadyGone: res.alreadyGone,
        });
      } else {
        results.push({
          faireProductId: item.faireProductId,
          reference: item.reference,
          status: "error",
          message: res.error ?? "Erreur inconnue",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Delete] Faire delete threw", {
        faireProductId: item.faireProductId,
        reference: item.reference,
        error: message,
      });
      results.push({
        faireProductId: item.faireProductId,
        reference: item.reference,
        status: "error",
        message,
      });
    }
  }
  return results;
}

// ─── Orderchamp ─────────────────────────────────────────────────────────────

export interface OrderchampDeleteOutcome {
  orderchampProductId: string;
  reference: string;
  status: "ok" | "error";
  alreadyGone?: boolean;
  message?: string;
}

/**
 * Suppression définitive d'une liste de produits côté Orderchamp.
 * Idempotent : « Product not found » = alreadyGone: true.
 */
export async function deleteProductsOnOrderchamp(
  items: Array<{ orderchampProductId: string; reference: string }>,
): Promise<OrderchampDeleteOutcome[]> {
  await requireAdmin();

  const orderchampEnabled = await getCachedOrderchampEnabled();
  if (!orderchampEnabled) {
    logger.info("[Marketplace Delete] Orderchamp disabled, skipping all deletes", { itemCount: items.length });
    return items.map((item) => ({
      orderchampProductId: item.orderchampProductId,
      reference: item.reference,
      status: "error" as const,
      message: "Orderchamp désactivé dans les paramètres — aucune suppression envoyée.",
    }));
  }

  const results: OrderchampDeleteOutcome[] = [];
  for (const item of items) {
    try {
      const res = await orderchampHardDeleteProduct(item.orderchampProductId);
      if (res.success) {
        const alreadyGone = res.deletedProductId === null;
        await prisma.product
          .updateMany({
            where: { orderchampProductId: item.orderchampProductId },
            data: {
              orderchampProductId: null,
              orderchampLastSyncSnapshot: Prisma.DbNull,
              orderchampSyncRequired: false,
            },
          })
          .catch(() => {});
        results.push({
          orderchampProductId: item.orderchampProductId,
          reference: item.reference,
          status: "ok",
          alreadyGone,
        });
      } else {
        results.push({
          orderchampProductId: item.orderchampProductId,
          reference: item.reference,
          status: "error",
          message: res.error ?? "Erreur inconnue",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Delete] Orderchamp delete threw", {
        orderchampProductId: item.orderchampProductId,
        reference: item.reference,
        error: message,
      });
      results.push({
        orderchampProductId: item.orderchampProductId,
        reference: item.reference,
        status: "error",
        message,
      });
    }
  }
  return results;
}

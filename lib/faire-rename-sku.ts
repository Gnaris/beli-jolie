/**
 * Renomme le SKU d'une variante côté Faire via PATCH /products/{id}/variants/{vid}.
 *
 * Cas d'usage : après une liaison manuelle, une variante Faire liée conserve
 * son SKU d'origine (créé par la brand via le portail Faire ou hérité d'un
 * ancien format). BJ génère de son côté ses propres SKU (`buildFaireVariantSkus`)
 * utilisés par les endpoints batch `/product-inventory/by-skus` et
 * `/product-prices/by-skus`. Sans alignement, ces batchs échouent avec
 * HTTP 404 « SKU inconnu » — Faire ne matche pas via l'ID de variante.
 *
 * Incident déclencheur : issyma / produit 1880 (2026-08-04). 8 couleurs liées
 * à la main le 2 août, tous les pushs prix ultérieurs échouaient 13/13 avec
 * un 404 sur le premier SKU BJ envoyé.
 *
 * Best-effort : un rename qui échoue n'annule PAS la liaison. Le filet de
 * sécurité `faireUpdatePrices` / `faireUpdateInventory` détecte le 404
 * ultérieur et remonte à l'admin un message clair « veuillez délier puis
 * relier ce produit à Faire ».
 */

import { faireFetch } from "@/lib/faire-api";
import { logger } from "@/lib/logger";

export async function faireRenameVariantSku(
  faireProductId: string,
  faireVariantId: string,
  newSku: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await faireFetch(
      `/products/${encodeURIComponent(faireProductId)}/variants/${encodeURIComponent(faireVariantId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ sku: newSku }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("[Faire Rename SKU] PATCH refusé", {
        faireProductId,
        faireVariantId,
        newSku,
        status: res.status,
        body: body.slice(0, 200),
      });
      return { success: false, error: `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    logger.warn("[Faire Rename SKU] exception réseau", {
      faireProductId,
      faireVariantId,
      newSku,
      error: String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

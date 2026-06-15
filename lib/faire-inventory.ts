/**
 * Faire Inventory — PATCH stock en bulk par SKU.
 *
 * Endpoint : `PATCH /product-inventory/by-skus` (schéma OpenAPI officiel Faire).
 * Le `available_quantity` envoyé dans `POST /products` est ignoré
 * silencieusement → après toute création/refresh il faut systématiquement
 * appeler cette fonction pour pousser le stock réel.
 *
 * ⚠️ Bug historique (corrigé 2026-06-15) : on envoyait `current_quantity` au
 * lieu de `on_hand_quantity`. Faire répondait 200 mais le champ inconnu était
 * silencieusement ignoré → le stock ne se mettait jamais à jour côté Faire.
 * Le champ `current_quantity` appartient à l'ANCIEN endpoint deprecated
 * `/products/variants/inventory-levels-by-skus` — ne pas mélanger.
 *
 * Limites :
 *   - ~500 SKUs par appel (estimé — pas de chiffre officiel).
 *   - 429 fréquents si on chaîne sans pause. Backoff intégré dans `faireFetch`.
 *
 * Format payload officiel :
 * {
 *   "inventories": [
 *     { "sku": "...", "on_hand_quantity": 24 }
 *   ]
 * }
 */

import { faireFetch } from "@/lib/faire-api";
import { logger } from "@/lib/logger";

export interface FaireInventoryUpdate {
  sku: string;
  /** Quantité disponible (entier ≥ 0). Envoyée comme `on_hand_quantity` à Faire. */
  currentQuantity: number;
}

export interface FaireInventoryResult {
  success: boolean;
  updatedCount: number;
  failedCount: number;
  errors: { sku: string; message: string }[];
}

const MAX_BATCH = 500;

/** Découpe une liste en chunks de taille `size`. */
export function chunkInventory<T>(items: T[], size = MAX_BATCH): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Construit le payload envoyé à Faire pour un chunk d'updates.
 * Exporté pour permettre des tests unitaires sans hit réseau.
 */
export function buildInventoryPayload(updates: FaireInventoryUpdate[]): {
  inventories: {
    sku: string;
    on_hand_quantity: number;
  }[];
} {
  return {
    inventories: updates.map((u) => ({
      sku: u.sku,
      on_hand_quantity: Math.max(0, Math.floor(u.currentQuantity)),
    })),
  };
}

/**
 * Pousse le stock à Faire en bulk. Découpe automatiquement en chunks de
 * `MAX_BATCH` SKUs. Erreurs partielles agrégées dans le résultat (un chunk
 * qui plante n'empêche pas les autres de partir).
 */
export async function faireUpdateInventory(
  updates: FaireInventoryUpdate[],
): Promise<FaireInventoryResult> {
  const result: FaireInventoryResult = {
    success: true,
    updatedCount: 0,
    failedCount: 0,
    errors: [],
  };

  if (updates.length === 0) return result;

  for (const batch of chunkInventory(updates)) {
    try {
      const res = await faireFetch(`/product-inventory/by-skus`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(buildInventoryPayload(batch)),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.error("[Faire Inventory] PATCH failed", {
          status: res.status,
          body: body.slice(0, 300),
          batchSize: batch.length,
        });
        for (const u of batch) {
          result.errors.push({ sku: u.sku, message: `HTTP ${res.status}` });
          result.failedCount++;
        }
        result.success = false;
        continue;
      }

      result.updatedCount += batch.length;
    } catch (err) {
      logger.error("[Faire Inventory] PATCH threw", { error: String(err) });
      for (const u of batch) {
        result.errors.push({
          sku: u.sku,
          message: err instanceof Error ? err.message : "fetch failed",
        });
        result.failedCount++;
      }
      result.success = false;
    }
  }

  return result;
}

/**
 * Orderchamp Inventory — bulk stock via GraphQL `inventoryLevelBulkAdjust`.
 *
 * Validé le 2026-08-19 : format bulk `inventoryLevels: [{productVariantId,
 * action, adjustment}, ...]`. Chaque item est indépendant.
 *
 * 2 actions dispos :
 *  - `SET`    : remplace le stock (utilisé pour la synchro régulière depuis BJ)
 *  - `ADJUST` : incrémente/décrémente (utilisé pour la déduction commande : -N)
 *
 * Identification variante : préférer `productVariantId` (GraphQL ID), sinon `sku`.
 */
import {
  orderchampGraphQL,
  extractUserErrors,
  formatUserErrors,
} from "@/lib/orderchamp-client";
import { INVENTORY_LEVEL_BULK_ADJUST_MUTATION } from "@/lib/orderchamp-queries";
import { logger } from "@/lib/logger";

export type OrderchampInventoryAction = "SET" | "ADJUST";

export interface OrderchampInventoryUpdate {
  /** Identifiant GraphQL de la variante (ex "UHJvZHVjdFZhcmlhbnQ6…"). */
  productVariantId?: string;
  /** SKU alternatif si l'ID GraphQL n'est pas connu. */
  sku?: string;
  action: OrderchampInventoryAction;
  /** Valeur pour SET, delta pour ADJUST. */
  adjustment: number;
}

export interface OrderchampInventoryResult {
  success: boolean;
  updatedCount: number;
  failedCount: number;
  errors: string[];
}

/** Chunk 100 par batch — pas de limite officielle documentée mais on garde ça raisonnable. */
const MAX_BATCH = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Ajuste le stock de plusieurs variantes en une ou plusieurs requêtes bulk.
 * Chaque item peut avoir sa propre action (SET pour synchro, ADJUST pour delta).
 */
export async function orderchampAdjustInventory(
  updates: OrderchampInventoryUpdate[],
): Promise<OrderchampInventoryResult> {
  if (updates.length === 0) {
    return { success: true, updatedCount: 0, failedCount: 0, errors: [] };
  }

  const errors: string[] = [];
  let updated = 0;
  let failed = 0;

  for (const batch of chunk(updates, MAX_BATCH)) {
    try {
      const payload = await orderchampGraphQL<{
        inventoryLevelBulkAdjust: { userErrors: Array<Record<string, unknown>> };
      }>(
        INVENTORY_LEVEL_BULK_ADJUST_MUTATION,
        {
          input: {
            inventoryLevels: batch.map((u) => ({
              productVariantId: u.productVariantId,
              sku: u.sku,
              action: u.action,
              adjustment: u.adjustment,
            })),
          },
        },
        "inventoryLevelBulkAdjust",
      );

      const userErrors = extractUserErrors(payload.inventoryLevelBulkAdjust);
      if (userErrors.length > 0) {
        failed += batch.length;
        const msg = formatUserErrors(userErrors);
        if (msg) errors.push(msg);
        logger.error("[Orderchamp Inventory] userErrors", { userErrors });
      } else {
        updated += batch.length;
      }
    } catch (err) {
      failed += batch.length;
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      errors.push(message);
      logger.error("[Orderchamp Inventory] batch failed", { batchSize: batch.length, error: message });
    }
  }

  return {
    success: failed === 0,
    updatedCount: updated,
    failedCount: failed,
    errors,
  };
}

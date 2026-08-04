/**
 * Faire Prices — PATCH prix en bulk par SKU.
 *
 * Endpoint : `PATCH /product-prices/by-skus` (schéma OpenAPI officiel Faire).
 *
 * ⚠️ Pourquoi un endpoint dédié et pas un PATCH variant individuel ?
 * Faire refuse de modifier les prix sur une seule variante isolément
 * (« You cannot change the currencies or geographic regions for a single
 * variant's prices… »). Le PATCH `/products/{id}/variants/{vid}` répond 200
 * mais ignore silencieusement les champs `wholesale_price_cents`,
 * `retail_price_cents` et `prices` — exactement le même piège que l'ancien
 * bug `current_quantity` sur l'inventory. Pour propager des changements de
 * prix, on doit passer par le batch officiel `by-skus`.
 *
 * Format payload officiel (cf. ExternalProductVariantV2.Price) :
 * {
 *   "prices": [
 *     {
 *       "sku": "...",
 *       "prices": [
 *         {
 *           "geo_constraint": { "country_group": "EUROPEAN_UNION" },
 *           "wholesale_price": { "amount_minor": 850, "currency": "EUR" },
 *           "retail_price":    { "amount_minor": 1700, "currency": "EUR" }
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

import { faireFetch } from "@/lib/faire-api";
import { logger } from "@/lib/logger";

export interface FairePriceUpdate {
  sku: string;
  /** Prix de gros en centimes EUR (entier ≥ 0). */
  wholesaleCents: number;
  /** Prix de vente conseillé en centimes EUR (entier ≥ 0). */
  retailCents: number;
}

export interface FairePricesResult {
  success: boolean;
  updatedCount: number;
  failedCount: number;
  errors: { sku: string; message: string }[];
  /**
   * SKU signalé « inconnu » par Faire (HTTP 404 avec `message` = le SKU
   * exact du batch). L'endpoint `by-skus` matche uniquement les SKU que Faire
   * connaît côté sa base : si UN SKU envoyé n'existe pas chez Faire, tout le
   * batch est rejeté en bloc. Signal explicite pour l'appelant : la fiche
   * Faire porte des SKU différents de ceux que BJ génère (typiquement après
   * une liaison manuelle mal alignée). Solution : délier puis relier.
   */
  unknownSku?: string | null;
}

const MAX_BATCH = 500;

export function chunkPrices<T>(items: T[], size = MAX_BATCH): T[][] {
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
export function buildPricesPayload(updates: FairePriceUpdate[]): {
  prices: {
    sku: string;
    prices: {
      geo_constraint: { country_group: "EUROPEAN_UNION" };
      wholesale_price: { amount_minor: number; currency: "EUR" };
      retail_price: { amount_minor: number; currency: "EUR" };
    }[];
  }[];
} {
  return {
    prices: updates.map((u) => ({
      sku: u.sku,
      prices: [
        {
          geo_constraint: { country_group: "EUROPEAN_UNION" as const },
          wholesale_price: {
            amount_minor: Math.max(0, Math.floor(u.wholesaleCents)),
            currency: "EUR" as const,
          },
          retail_price: {
            amount_minor: Math.max(0, Math.floor(u.retailCents)),
            currency: "EUR" as const,
          },
        },
      ],
    })),
  };
}

/**
 * Pousse les prix à Faire en bulk. Découpe automatiquement en chunks de
 * `MAX_BATCH` SKUs. Erreurs partielles agrégées dans le résultat (un chunk
 * qui plante n'empêche pas les autres de partir).
 */
export async function faireUpdatePrices(
  updates: FairePriceUpdate[],
): Promise<FairePricesResult> {
  const result: FairePricesResult = {
    success: true,
    updatedCount: 0,
    failedCount: 0,
    errors: [],
  };

  if (updates.length === 0) return result;

  for (const batch of chunkPrices(updates)) {
    try {
      const res = await faireFetch(`/product-prices/by-skus`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(buildPricesPayload(batch)),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // Faire renvoie 404 avec `message` = le SKU introuvable quand un des
        // SKU du batch n'existe pas côté Faire (l'endpoint est atomique).
        // On l'extrait pour permettre à l'appelant de renvoyer un message
        // clair à l'admin (« délier puis relier »).
        let unknownSku: string | null = null;
        if (res.status === 404) {
          try {
            const j = JSON.parse(body) as { message?: string };
            if (
              typeof j.message === "string" &&
              batch.some((u) => u.sku === j.message)
            ) {
              unknownSku = j.message;
            }
          } catch {
            // pas un JSON parseable — on garde unknownSku à null
          }
        }
        logger.error("[Faire Prices] PATCH failed", {
          status: res.status,
          body: body.slice(0, 300),
          batchSize: batch.length,
          unknownSku,
        });
        for (const u of batch) {
          result.errors.push({ sku: u.sku, message: `HTTP ${res.status}` });
          result.failedCount++;
        }
        result.success = false;
        if (unknownSku && !result.unknownSku) result.unknownSku = unknownSku;
        continue;
      }

      result.updatedCount += batch.length;
    } catch (err) {
      logger.error("[Faire Prices] PATCH threw", { error: String(err) });
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

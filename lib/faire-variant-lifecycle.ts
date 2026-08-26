/**
 * Faire — synchronisation du `lifecycle_state` par variante.
 *
 * Le champ `active` du schéma variant est ignoré silencieusement par Faire.
 * Le seul vrai levier pour masquer une variante sans toucher son stock est
 * de passer son `lifecycle_state` à `UNPUBLISHED` via un PATCH ciblé.
 *
 * Ce comportement n'est PAS documenté dans l'OpenAPI officielle (le champ y
 * est marqué "Read-only") mais l'endpoint l'accepte bel et bien — vérifié en
 * réel sur A2251(2) / po_6xk62rpezy le 2026-08-26.
 *
 * Règle métier :
 *   - `ProductColor.disabled = true`  → Faire variant `UNPUBLISHED`
 *   - `ProductColor.disabled = false` → Faire variant `PUBLISHED`
 *
 * Le stock envoyé à Faire suit le vrai stock BDD, sans écrasement.
 */

import { faireFetch } from "@/lib/faire-api";
import { logger } from "@/lib/logger";

export type FaireVariantLifecycle = "PUBLISHED" | "UNPUBLISHED";

export interface FaireVariantLifecycleUpdate {
  faireProductId: string;
  faireVariantId: string;
  target: FaireVariantLifecycle;
  /** Utilisé uniquement pour les logs — pas envoyé à Faire. */
  bjVariantId?: string;
}

export interface FaireVariantLifecycleResult {
  success: boolean;
  updatedCount: number;
  failedCount: number;
  errors: { faireVariantId: string; message: string }[];
}

/**
 * Traduit `disabled` en `lifecycle_state` Faire.
 * Exporté pour tests unitaires.
 */
export function lifecycleFromDisabled(disabled: boolean): FaireVariantLifecycle {
  return disabled ? "UNPUBLISHED" : "PUBLISHED";
}

/**
 * Pousse un batch de mises à jour `lifecycle_state` variante à Faire.
 * Chaque PATCH est un appel séparé (Faire n'expose pas de bulk pour ce champ).
 */
export async function faireSyncVariantLifecycles(
  updates: FaireVariantLifecycleUpdate[],
): Promise<FaireVariantLifecycleResult> {
  const result: FaireVariantLifecycleResult = {
    success: true,
    updatedCount: 0,
    failedCount: 0,
    errors: [],
  };

  for (const u of updates) {
    try {
      const res = await faireFetch(
        `/products/${u.faireProductId}/variants/${u.faireVariantId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ lifecycle_state: u.target }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.error("[Faire] variant lifecycle PATCH failed", {
          faireVariantId: u.faireVariantId,
          target: u.target,
          status: res.status,
          body: body.slice(0, 300),
        });
        result.errors.push({
          faireVariantId: u.faireVariantId,
          message: `HTTP ${res.status}`,
        });
        result.failedCount++;
        result.success = false;
        continue;
      }

      result.updatedCount++;
    } catch (err) {
      logger.error("[Faire] variant lifecycle PATCH threw", {
        faireVariantId: u.faireVariantId,
        target: u.target,
        error: err instanceof Error ? err.message : String(err),
      });
      result.errors.push({
        faireVariantId: u.faireVariantId,
        message: err instanceof Error ? err.message : "fetch failed",
      });
      result.failedCount++;
      result.success = false;
    }
  }

  return result;
}

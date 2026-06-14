/**
 * Faire Delete / Unpublish — gestion de la fin de vie d'un produit côté Faire.
 *
 * Faire encourage l'archivage (UNPUBLISHED) plutôt que la suppression hard. Mapping :
 *   - BJ `ARCHIVED`     → PATCH lifecycle_state="UNPUBLISHED" (réversible côté portail)
 *   - Suppression locale → DELETE /products/{id}              (irréversible)
 *
 * Le flow normal côté UI (bouton "Archiver" sur la fiche produit) appelle
 * `faireUnpublishProduct`. `faireHardDeleteProduct` est réservé au refresh
 * (qui doit purger l'ancien ID avant de réenregistrer un nouveau produit).
 *
 * États valides côté Faire (confirmés IA Faire juin 2026) :
 *   lifecycle_state : DRAFT | PUBLISHED | UNPUBLISHED | DELETED
 *   sale_state      : FOR_SALE | SALES_PAUSED
 */

import { faireFetch } from "@/lib/faire-api";
import { logger } from "@/lib/logger";

export interface FaireDeleteResult {
  success: boolean;
  /** True quand Faire a renvoyé 404 — le produit n'existait déjà plus côté distant. */
  alreadyGone?: boolean;
  error?: string;
}

/**
 * Marque le produit comme UNPUBLISHED côté Faire. Le produit reste visible
 * dans l'historique du portail brand mais n'est plus commandable.
 */
export async function faireUnpublishProduct(
  faireProductId: string,
): Promise<FaireDeleteResult> {
  try {
    const res = await faireFetch(`/products/${encodeURIComponent(faireProductId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ lifecycle_state: "UNPUBLISHED" }),
    });

    if (res.status === 404) {
      logger.warn("[Faire Delete] PATCH UNPUBLISHED — produit introuvable", {
        faireProductId,
      });
      return { success: true, alreadyGone: true };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("[Faire Delete] PATCH UNPUBLISHED failed", {
        faireProductId,
        status: res.status,
        body: body.slice(0, 300),
      });
      return { success: false, error: `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    logger.error("[Faire Delete] PATCH UNPUBLISHED threw", {
      faireProductId,
      error: String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

/**
 * Suppression hard (irréversible). À n'utiliser que dans le flow `refresh`,
 * où on doit libérer l'ID avant de re-créer un nouveau produit.
 *
 * Faire renvoie 404 si l'ID n'existe plus — on traite ça comme un succès
 * idempotent (= déjà supprimé).
 */
export async function faireHardDeleteProduct(
  faireProductId: string,
): Promise<FaireDeleteResult> {
  try {
    const res = await faireFetch(`/products/${encodeURIComponent(faireProductId)}`, {
      method: "DELETE",
    });

    if (res.status === 404) {
      return { success: true, alreadyGone: true };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("[Faire Delete] DELETE failed", {
        faireProductId,
        status: res.status,
        body: body.slice(0, 300),
      });
      return { success: false, error: `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    logger.error("[Faire Delete] DELETE threw", {
      faireProductId,
      error: String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

/**
 * Re-publie un produit UNPUBLISHED : PATCH lifecycle_state="PUBLISHED".
 * Utilisé quand un produit BJ repasse de ARCHIVED à ONLINE/OFFLINE.
 *
 * Note : on n'envoie pas `sale_state` — c'est un champ read-only côté Faire,
 * géré automatiquement selon le stock vs MOQ.
 */
export async function faireRepublishProduct(
  faireProductId: string,
): Promise<FaireDeleteResult> {
  try {
    const res = await faireFetch(`/products/${encodeURIComponent(faireProductId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        lifecycle_state: "PUBLISHED",
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("[Faire Delete] republish failed", {
        faireProductId,
        status: res.status,
        body: body.slice(0, 300),
      });
      return { success: false, error: `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

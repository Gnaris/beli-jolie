"use server";

/**
 * Recherche + preview Ankorstore par référence/nom pour le modal unifié de
 * liaison marketplace.
 *
 * L'ancien modal Ankorstore chargeait tout le catalogue via SSE (~5 s) puis
 * filtrait localement dans le navigateur. Ici on utilise le cache serveur
 * (`ankorstore-catalog-cache.ts`, TTL 6 h, préchargé au boot) + le scoring
 * local pour trouver le meilleur candidat, puis on délègue à
 * `previewAnkorstoreProductForLinking()` pour construire la preview complète.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireCurrentTenant } from "@/lib/tenant";
import {
  getCachedCatalog,
  loadFullCatalog,
  filterCatalogEntries,
} from "@/lib/ankorstore-catalog-cache";
import { previewAnkorstoreProductForLinking } from "@/app/actions/admin/ankorstore";
import type { AnkorstoreLinkPreview } from "@/app/actions/admin/ankorstore";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export async function searchAndPreviewAnkorstoreByQuery(
  productId: string,
  query: string,
): Promise<
  | { success: true; data: AnkorstoreLinkPreview; totalMatches: number }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();

    // Utilise le cache s'il est frais, sinon force un chargement complet
    let entries = getCachedCatalog(tenant.id);
    if (!entries) {
      await loadFullCatalog(tenant.id);
      entries = getCachedCatalog(tenant.id);
    }
    if (!entries || entries.length === 0) {
      return { success: false, error: "Catalogue Ankorstore vide." };
    }

    const matches = filterCatalogEntries(entries, query);
    if (matches.length === 0) {
      return { success: false, error: `Aucun produit Ankorstore trouvé pour « ${query} ».` };
    }

    // Le catalogue est trié par pertinence — on prend le premier.
    const best = matches[0];
    const previewRes = await previewAnkorstoreProductForLinking(productId, best.id);
    if (!previewRes.success) {
      return { success: false, error: previewRes.error };
    }
    return { success: true, data: previewRes.data, totalMatches: matches.length };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

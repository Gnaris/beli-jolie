"use server";

/**
 * Recherche + preview Ankorstore pour le modal unifié de liaison marketplace.
 *
 * Stratégie en cascade (chaque étape est courte — pas de blocage sur le
 * chargement complet du catalogue) :
 *
 *  1. Si le produit BJ a déjà un `ankorsProductId` en BDD → GET direct
 *     `/products/{id}`. 1 appel API, quasi-instantané. Couvre le cas
 *     principal : re-liaison ou vérification d'un produit déjà lié.
 *
 *  2. Sinon (ou si le GET direct a échoué avec un ID obsolète) → recherche
 *     via `filter[skuOrName]` (`ankorstoreSearchProducts`) qui fait 1-2
 *     appels API et couvre 95 % des cas. On prend le meilleur candidat
 *     (déjà scoré par pertinence côté `sortAnkorstoreSearchResults`).
 *
 *  3. Fallback ultime : le cache complet du catalogue, MAIS uniquement s'il
 *     est déjà chaud (préchargé au boot ou déjà rempli par un autre écran).
 *     Jamais on ne bloque la modale sur un chargement de catalogue en cours —
 *     mieux vaut renvoyer une erreur claire à la cliente que 60 s d'attente.
 *
 * Historique : la V1 (commit 0e926198) chargeait tout le catalogue en cache
 * puis filtrait localement. Rapide en régime établi (cache chaud), mais 30-60 s
 * de blocage à froid (curseur pagination = séquentiel obligatoire côté API
 * Ankorstore). La nouvelle version utilise les endpoints natifs Ankorstore
 * qui sont conçus pour ce use case.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireCurrentTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import {
  ankorstoreGetProduct,
  ankorstoreSearchProducts,
} from "@/lib/ankorstore-api";
import {
  getCachedCatalog,
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

    // ── Étape 1 : GET direct si déjà lié ───────────────────────────────
    // L'ID stocké côté BJ pointe vers la fiche Ankorstore actuelle. Un simple
    // GET suffit — pas besoin de rechercher.
    const bjHint = await prisma.product.findUnique({
      where: { id: productId },
      select: { ankorsProductId: true },
    });
    if (bjHint?.ankorsProductId) {
      const previewRes = await previewAnkorstoreProductForLinking(
        productId,
        bjHint.ankorsProductId,
      );
      if (previewRes.success) {
        return { success: true, data: previewRes.data, totalMatches: 1 };
      }
      // Si le GET a échoué (produit archivé/supprimé côté Ankorstore), on
      // tombe sur les étapes suivantes plutôt que d'échouer directement.
    }

    // ── Étape 2 : recherche rapide via filter[skuOrName] ──────────────
    // ankorstoreSearchProducts fait 1 appel `/product-variants?filter[skuOrName]=…`
    // (rapide), avec fallback interne vers `/products?filter[skuOrName]` si
    // le filtre variantes ne matche rien.
    //
    // On DÉSACTIVE le scan large (`skipWideScan: true`) : dans la modale de
    // liaison, si les 2 filtres API renvoient 0, la fiche n'existe presque
    // jamais côté marketplace (cas Issyma). Scanner 4 000 fiches à sec = 30-60 s
    // dans le vide. Mieux vaut afficher « pas trouvé » tout de suite.
    const candidates = await ankorstoreSearchProducts(query, 5, {
      skipWideScan: true,
    });
    if (candidates.length > 0) {
      // Le tableau est déjà trié par pertinence côté ankorstoreSearchProducts.
      const previewRes = await previewAnkorstoreProductForLinking(
        productId,
        candidates[0].id,
      );
      if (previewRes.success) {
        return {
          success: true,
          data: previewRes.data,
          totalMatches: candidates.length,
        };
      }
      // Preview a échoué (rare) → on tente le fallback cache.
    }

    // ── Étape 3 : fallback cache complet (uniquement si déjà chaud) ───
    // On ne DÉCLENCHE PAS de chargement si le cache est vide — mieux vaut
    // rendre la main tout de suite que faire attendre 60 s.
    const cached = getCachedCatalog(tenant.id);
    if (cached && cached.length > 0) {
      const matches = filterCatalogEntries(cached, query);
      if (matches.length > 0) {
        const previewRes = await previewAnkorstoreProductForLinking(
          productId,
          matches[0].id,
        );
        if (previewRes.success) {
          return {
            success: true,
            data: previewRes.data,
            totalMatches: matches.length,
          };
        }
      }
    }

    return {
      success: false,
      error: `Aucun produit Ankorstore trouvé pour « ${query} ».`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

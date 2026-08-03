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
  ankorstoreFindProductIdBySku,
  type AnkorstoreProduct,
} from "@/lib/ankorstore-api";
import {
  getCachedCatalog,
  filterCatalogEntries,
} from "@/lib/ankorstore-catalog-cache";
import { scoreAnkorstoreSearchResult } from "@/lib/ankorstore-search-rank";
import { logger } from "@/lib/logger";
import { previewAnkorstoreProductForLinking } from "@/app/actions/admin/ankorstore";
import type { AnkorstoreLinkPreview } from "@/app/actions/admin/ankorstore";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

/**
 * Cherche les produits Ankorstore correspondant à un produit BJ via lookup SKU
 * exact (le seul chemin fiable pour certaines refs — cf. bug E598/A164 où
 * `filter[skuOrName]` renvoie 0 alors que les SKUs existent).
 *
 * Renvoie tableau vide si aucune variante BJ n'a de SKU, ou si aucune n'est
 * trouvée côté Ankor. Dédupe si plusieurs SKUs BJ pointent vers le même
 * produit Ankor.
 */
async function findAnkorstoreProductsByBjSkus(
  bjProductId: string,
): Promise<AnkorstoreProduct[]> {
  const bj = await prisma.product.findUnique({
    where: { id: bjProductId },
    select: {
      colors: {
        where: { saleType: "UNIT" },
        select: { sku: true },
      },
    },
  });
  const skus = (bj?.colors ?? [])
    .map((c) => c.sku)
    .filter((s): s is string => !!s);
  if (skus.length === 0) return [];

  const productIds = new Set<string>();
  await Promise.all(
    skus.map(async (sku) => {
      try {
        const pid = await ankorstoreFindProductIdBySku(sku);
        if (pid) productIds.add(pid);
      } catch (err) {
        logger.warn("[Ankorstore] SKU lookup failed", {
          sku,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  if (productIds.size === 0) return [];

  const products = await Promise.all(
    [...productIds].map((pid) =>
      ankorstoreGetProduct(pid).catch(() => null),
    ),
  );
  return products.filter((p): p is AnkorstoreProduct => p !== null);
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

    // ── Étape 1.5 : lookup exact par SKU BJ ────────────────────────────
    // Chemin le plus fiable : on connaît les SKUs UNIT côté BJ (ex :
    // A164_NOIR_UNIT_2, E598_DORE_UNIT_4), on interroge Ankor variante
    // par variante avec `filter[sku]=X`. Contrairement à `filter[skuOrName]`
    // qui est instable et rate certaines refs (bug 2026-08-03), le lookup
    // par SKU exact est indexé et 100 % fiable.
    const bySku = await findAnkorstoreProductsByBjSkus(productId);
    if (bySku.length > 0) {
      const previewRes = await previewAnkorstoreProductForLinking(
        productId,
        bySku[0].id,
      );
      if (previewRes.success) {
        return {
          success: true,
          data: previewRes.data,
          totalMatches: bySku.length,
        };
      }
    }

    // ── Étape 2 : cache complet du catalogue s'il est chaud ────────────
    // Le cache est préchargé au boot pm2 (~10 000 produits BJ, reload 6h).
    // Filtrage in-memory = quelques ms là où l'API `filter[skuOrName]` prend
    // 30-40 s par appel — et rate les SKUs à underscore comme E598_DORE_UNIT_4.
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
      // Cache chaud sans match = la fiche n'existe pas (ou pas encore indexée
      // depuis le dernier reload). On continue quand même sur l'API au cas où.
    }

    // ── Étape 3 : recherche via l'API Ankorstore ─────────────────────────
    // Cache pas prêt (boot en cours) → on retombe sur l'API. `skipWideScan: false`
    // pour couvrir les SKUs que le tokenizer Ankorstore ignore (ex : E598).
    const candidates = await ankorstoreSearchProducts(query, 20, {
      skipWideScan: false,
    });
    // Filtre anti-parasites : Ankorstore renvoie parfois des produits qui
    // n'ont rien à voir avec la requête (score 10 = « match indirect sans
    // rapport direct »). Sans ce filtre, chercher A164 remonte A670 en 1er
    // candidat et la preview charge les variants d'A670 — bug 2026-08-03.
    const relevant = candidates.filter(
      (p) => scoreAnkorstoreSearchResult(p, query) >= 20,
    );
    if (relevant.length > 0) {
      const previewRes = await previewAnkorstoreProductForLinking(
        productId,
        relevant[0].id,
      );
      if (previewRes.success) {
        return {
          success: true,
          data: previewRes.data,
          totalMatches: relevant.length,
        };
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

// ────────────────────────────────────────────────────────────────────────────
// searchAnkorstoreCandidatesList
// ────────────────────────────────────────────────────────────────────────────

/** Vignette d'un produit marketplace, affichée dans le picker de la modale de
 *  liaison quand la recherche renvoie plusieurs candidats à trancher. */
export interface MarketplaceCandidateProduct {
  /** ID marketplace (opaque, réutilisé pour charger la preview). */
  id: string;
  /** Nom du produit côté marketplace. */
  name: string;
  /** URL de la 1ʳᵉ image (déjà proxifiée si nécessaire). */
  imageUrl: string | null;
  /** SKU d'exemple (celui de la 1ʳᵉ variante) pour aider l'admin à identifier. */
  sampleSku: string | null;
  /** Nombre de variantes du produit côté marketplace. */
  variantCount: number;
  /** Statut lifecycle éventuel (Faire : PUBLISHED/DRAFT/…). Vide pour Ankorstore. */
  lifecycleState: string | null;
  /** Référence extraite quand elle est reconnaissable (aide à trier visuellement). */
  extractedReference: string | null;
}

/**
 * Renvoie la liste COMPLÈTE des candidats Ankorstore matchant la référence,
 * triée par pertinence (SKU exact → préfixe → contient → nom). Sert au picker
 * de la modale de liaison quand la référence a des suffixes (676A, 676GD…).
 *
 * Contrairement à `searchAndPreviewAnkorstoreByQuery`, on N'appelle PAS de
 * preview automatique : on renvoie juste la liste pour laisser l'admin choisir
 * le bon produit à la main.
 */
export async function searchAnkorstoreCandidatesList(
  query: string,
  bjProductId?: string,
): Promise<
  | { success: true; data: { candidates: MarketplaceCandidateProduct[]; truncated: boolean } }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();

    const q = query.trim();
    if (!q) return { success: false, error: "Référence vide." };

    // ── Étape 0 : lookup exact par SKU BJ (le plus fiable) ─────────────
    // Si on connaît le produit BJ, on interroge Ankor directement avec les
    // SKUs UNIT stockés en base. C'est le seul chemin qui trouve des refs
    // comme A164 / E598 dont `filter[skuOrName]` retourne 0 malgré leur
    // existence côté Ankor (bug de l'API confirmé 2026-08-03).
    if (bjProductId) {
      const bySku = await findAnkorstoreProductsByBjSkus(bjProductId);
      if (bySku.length > 0) {
        const candidates: MarketplaceCandidateProduct[] = bySku.map((p) =>
          toCandidateProduct(p),
        );
        return {
          success: true,
          data: { candidates, truncated: false },
        };
      }
    }

    // ── Étape 1 : cache complet du catalogue s'il est chaud ─────────────
    // Le cache Ankorstore est préchargé au boot pm2 et rechargé toutes les 6 h
    // (~10 000 produits BJ). Filtrage in-memory = < 100 ms pour un match sur
    // ref/externalId/nom, là où le filter[skuOrName] de l'API prend 30-40 s
    // par appel — et rate quand même les SKUs à underscore comme
    // `E598_DORE_UNIT_4` (bug constaté 2026-08-03).
    const cached = getCachedCatalog(tenant.id);
    if (cached && cached.length > 0) {
      const matches = filterCatalogEntries(cached, q).slice(0, 100);
      if (matches.length > 0) {
        const candidates: MarketplaceCandidateProduct[] = matches.map((entry) => ({
          id: entry.id,
          name: entry.name,
          imageUrl: entry.firstImageUrl,
          sampleSku: null, // le cache n'indexe pas les SKUs, non-bloquant pour le picker
          variantCount: entry.variantCount,
          lifecycleState: null,
          extractedReference: entry.externalId ?? entry.ref,
        }));
        return {
          success: true,
          data: {
            candidates,
            truncated: matches.length >= 100,
          },
        };
      }
      // Cache chaud sans match = la fiche n'existe pas (ou pas encore indexée
      // depuis le dernier reload de cache). On continue quand même sur l'API
      // au cas où le cache serait périmé.
    }

    // ── Étape 2 : recherche via l'API Ankorstore ─────────────────────────
    // Cache pas prêt (boot en cours) → on fait l'appel API classique.
    // `skipWideScan: false` : on garde le scan large en dernier recours pour
    // les SKUs que le tokenizer Ankorstore ignore (ex : E598_DORE_UNIT_4).
    // Ça coûte 30-60 s d'attente mais c'est le seul chemin qui marche quand
    // le cache est froid.
    const products = await ankorstoreSearchProducts(q, 100, {
      skipWideScan: false,
    });

    // Filtre anti-parasites : Ankorstore renvoie parfois des produits qui
    // n'ont rien à voir avec la requête (score 10 = « match indirect sans
    // rapport direct »). Ex bug 2026-08-03 sur A164 qui remontait A687, ZB09A,
    // P14 en fond de picker. On garde uniquement les scores ≥ 20 (min = 30
    // pour name.includes, 50 pour sku.includes…).
    const filtered = products.filter(
      (p) => scoreAnkorstoreSearchResult(p, q) >= 20,
    );

    const candidates: MarketplaceCandidateProduct[] = filtered.map((p) =>
      toCandidateProduct(p),
    );

    return {
      success: true,
      data: {
        candidates,
        truncated: candidates.length >= 100,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

function toCandidateProduct(p: AnkorstoreProduct): MarketplaceCandidateProduct {
  const firstImage = [...p.images].sort((a, b) => a.order - b.order)[0]?.url ?? null;
  const firstSku =
    p.variants.map((v) => v.sku).find((s): s is string => !!s) ?? null;
  return {
    id: p.id,
    name: p.name,
    imageUrl: firstImage,
    sampleSku: firstSku,
    variantCount: p.variants.length,
    lifecycleState: null,
    extractedReference: p.externalId ?? null,
  };
}

"use server";

/**
 * Server actions du picker « Configurer un lien » de l'éditeur newsletter HTML.
 *
 * Fournit :
 *  - `getNewsletterEditorBaseUrl` : base URL de la boutique (pour construire
 *    les URLs absolues côté client au moment de la validation du picker).
 *  - `searchProductsForLink` : recherche paginée par nom/référence.
 *  - `listCategoriesForLink` : liste plate des catégories (slug + label).
 *  - `listCollectionsForLink` : liste plate des collections (slug + label).
 *
 * Toutes scopées au tenant courant via `requireAdmin()`. Silencieuses côté
 * client si la boutique n'a aucune catégorie/collection — le picker affiche
 * juste « aucune option » et propose de revenir en arrière.
 */

import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { buildProductHandle } from "@/lib/product-url";

export async function getNewsletterEditorBaseUrl(): Promise<string> {
  await requireAdmin();
  return getCurrentTenantBaseUrl();
}

export interface ProductLinkOption {
  id: string;
  name: string;
  reference: string;
  handle: string;
}

/**
 * Recherche max 20 produits ONLINE du tenant courant par nom ou référence
 * (contains, case-insensitive côté MySQL). Query vide → retourne les 20 plus
 * récemment modifiés (utile pour une exploration rapide).
 */
export async function searchProductsForLink(query: string): Promise<ProductLinkOption[]> {
  const { tenant } = await requireAdmin();
  const q = query.trim();
  const rows = await prisma.product.findMany({
    where: {
      tenantId: tenant.id,
      status: "ONLINE",
      ...(q
        ? { OR: [{ name: { contains: q } }, { reference: { contains: q } }] }
        : {}),
    },
    take: 20,
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, reference: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    reference: r.reference,
    handle: buildProductHandle(r.name, r.reference),
  }));
}

export interface CategoryLinkOption {
  id: string;
  name: string;
  slug: string;
}

export async function listCategoriesForLink(): Promise<CategoryLinkOption[]> {
  const { tenant } = await requireAdmin();
  const rows = await prisma.category.findMany({
    where: { tenantId: tenant.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
  return rows;
}

export interface CollectionLinkOption {
  id: string;
  name: string;
  slug: string;
}

export async function listCollectionsForLink(): Promise<CollectionLinkOption[]> {
  const { tenant } = await requireAdmin();
  const rows = await prisma.collection.findMany({
    where: { tenantId: tenant.id, slug: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
  return rows
    .filter((r) => r.slug != null)
    .map((r) => ({ id: r.id, name: r.name, slug: r.slug! }));
}

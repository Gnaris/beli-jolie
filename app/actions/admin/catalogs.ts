"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Créer un catalogue
// ─────────────────────────────────────────────
export async function createCatalog(title: string) {
  await requireAdmin();
  // Défaut ACTIVE : la cliente veut que le lien public marche tout de suite
  // sans passer par un toggle. Le default Prisma reste INACTIVE pour ne pas
  // toucher aux catalogues existants.
  const catalog = await prisma.catalog.create({
    data: { title, status: "ACTIVE" },
  });
  revalidatePath("/admin/catalogues");
  return catalog;
}

// ─────────────────────────────────────────────
// Mettre à jour titre + statut + visibilité prix
// ─────────────────────────────────────────────
export async function updateCatalog(
  id: string,
  data: {
    title?: string;
    status?: "INACTIVE" | "ACTIVE";
    priceVisibility?: "SHOW" | "HIDE" | "CONNECTED_ONLY";
  }
) {
  await requireAdmin();
  const catalog = await prisma.catalog.update({
    where: { id },
    data,
    select: { token: true },
  });
  revalidatePath("/admin/catalogues");
  revalidatePath(`/admin/catalogues/${id}`);
  // La visibilité prix est lue au rendu de la page publique — il faut donc
  // invalider le cache Next.js sur le lien partagé quand on la change.
  revalidatePath(`/catalogue/${catalog.token}`);
}

// ─────────────────────────────────────────────
// Supprimer un catalogue
// ─────────────────────────────────────────────
export async function deleteCatalog(id: string) {
  await requireAdmin();
  // P3-11 — récupérer le token AVANT la suppression pour pouvoir invalider
  // la page publique /catalogue/{token} (sinon elle reste en cache).
  const catalog = await prisma.catalog.findUnique({
    where: { id },
    select: { token: true },
  });
  await prisma.catalog.delete({ where: { id } });
  revalidatePath("/admin/catalogues");
  if (catalog?.token) {
    revalidatePath(`/catalogue/${catalog.token}`);
  }
}

// ─────────────────────────────────────────────
// Ajouter un produit au catalogue
// ─────────────────────────────────────────────
export async function addProductToCatalog(catalogId: string, productId: string) {
  await requireAdmin();
  // Prendre la position la plus haute + 1
  const last = await prisma.catalogProduct.findFirst({
    where: { catalogId },
    orderBy: { position: "desc" },
  });
  await prisma.catalogProduct.upsert({
    where: { catalogId_productId: { catalogId, productId } },
    update: {},
    create: { catalogId, productId, position: (last?.position ?? -1) + 1 },
  });
  revalidatePath(`/admin/catalogues/${catalogId}`);
}

// ─────────────────────────────────────────────
// Retirer un produit du catalogue
// ─────────────────────────────────────────────
export async function removeProductFromCatalog(catalogId: string, productId: string) {
  await requireAdmin();
  await prisma.catalogProduct.deleteMany({ where: { catalogId, productId } });
  revalidatePath(`/admin/catalogues/${catalogId}`);
}

// ─────────────────────────────────────────────
// Changer la couleur et/ou l'image affichées pour un produit dans le catalogue
// ─────────────────────────────────────────────
export async function updateCatalogProductDisplay(
  catalogId: string,
  productId: string,
  selectedColorId: string | null,
  selectedImagePath: string | null
) {
  await requireAdmin();
  await prisma.catalogProduct.updateMany({
    where: { catalogId, productId },
    data: { selectedColorId, selectedImagePath },
  });
  revalidatePath(`/admin/catalogues/${catalogId}`);
}

// ─────────────────────────────────────────────
// Lecture d'un catalogue complet (pour l'éditeur)
// ─────────────────────────────────────────────
export async function getCatalogWithProducts(id: string) {
  await requireAdmin();
  return prisma.catalog.findUnique({
    where: { id },
    include: {
      products: {
        orderBy: { position: "asc" },
        include: {
          product: {
            include: {
              // Toutes les couleurs UNIT avec le nom/hex de la couleur
              colors: {
                where: { saleType: "UNIT" },
                include: {
                  color: { select: { id: true, name: true, hex: true } },
                },
              },
              // Toutes les images (on filtrera par colorId côté client/serveur)
              colorImages: { orderBy: { order: "asc" } },
            },
          },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────
// Statistiques de fréquentation
// ─────────────────────────────────────────────

export interface CatalogStatsView {
  id: string;
  viewedAt: Date;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    company: string | null;
  } | null;
}

export interface CatalogStatsCartAddition {
  id: string;
  addedAt: Date;
  quantity: number;
  product: { id: string; name: string; reference: string };
  variant: { id: string; colorName: string | null } | null;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    company: string | null;
  };
}

export interface CatalogStats {
  catalog: { id: string; title: string; token: string };
  totalViews: number;
  anonymousViews: number;
  connectedViews: number;
  views: CatalogStatsView[];
  cartAdditions: CatalogStatsCartAddition[];
}

/**
 * Récupère les stats de fréquentation pour l'onglet « Statistiques » admin.
 * - Compteurs globaux : total vues, anonymes, connectées.
 * - Détail des 200 dernières visites (avec identité client si connecté).
 * - Détail des ajouts au panier attribués à ce catalogue (produit +
 *   couleur + quantité + client + date).
 */
export async function getCatalogStats(id: string): Promise<CatalogStats> {
  await requireAdmin();

  const catalog = await prisma.catalog.findUnique({
    where: { id },
    select: { id: true, title: true, token: true },
  });
  if (!catalog) throw new Error("Catalogue introuvable.");

  const [totalViews, anonymousViews, views, cartAdditionsRaw] = await Promise.all([
    prisma.catalogView.count({ where: { catalogId: id } }),
    prisma.catalogView.count({ where: { catalogId: id, userId: null } }),
    prisma.catalogView.findMany({
      where: { catalogId: id },
      orderBy: { viewedAt: "desc" },
      take: 200,
      select: {
        id: true,
        viewedAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            company: true,
          },
        },
      },
    }),
    prisma.catalogCartAddition.findMany({
      where: { catalogId: id },
      orderBy: { addedAt: "desc" },
      take: 500,
      select: {
        id: true,
        addedAt: true,
        quantity: true,
        variantId: true,
        product: { select: { id: true, name: true, reference: true } },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            company: true,
          },
        },
      },
    }),
  ]);

  // Résolution du nom couleur pour chaque ajout au panier — la variante peut
  // avoir été supprimée depuis, on tolère `null`.
  const variantIds = cartAdditionsRaw
    .map((a) => a.variantId)
    .filter((v): v is string => Boolean(v));
  const variants =
    variantIds.length > 0
      ? await prisma.productColor.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, color: { select: { name: true } } },
        })
      : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const cartAdditions: CatalogStatsCartAddition[] = cartAdditionsRaw.map((a) => ({
    id: a.id,
    addedAt: a.addedAt,
    quantity: a.quantity,
    product: a.product,
    variant: a.variantId
      ? { id: a.variantId, colorName: variantById.get(a.variantId)?.color?.name ?? null }
      : null,
    user: a.user,
  }));

  return {
    catalog,
    totalViews,
    anonymousViews,
    connectedViews: totalViews - anonymousViews,
    views,
    cartAdditions,
  };
}

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
  const catalog = await prisma.catalog.create({
    data: { title },
  });
  revalidatePath("/admin/catalogues");
  return catalog;
}

// ─────────────────────────────────────────────
// Mettre à jour titre + statut
// ─────────────────────────────────────────────
export async function updateCatalog(
  id: string,
  data: {
    title?: string;
    status?: "INACTIVE" | "ACTIVE";
  }
) {
  await requireAdmin();
  await prisma.catalog.update({ where: { id }, data });
  revalidatePath("/admin/catalogues");
  revalidatePath(`/admin/catalogues/${id}`);
}

// ─────────────────────────────────────────────
// Supprimer un catalogue
// ─────────────────────────────────────────────
export async function deleteCatalog(id: string) {
  await requireAdmin();
  await prisma.catalog.delete({ where: { id } });
  revalidatePath("/admin/catalogues");
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

"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Schémas de validation
// ─────────────────────────────────────────────

const CollectionSchema = z.object({
  name:  z.string().min(1, "Le nom est requis.").max(100),
  image: z.string().optional(),
});

// ─────────────────────────────────────────────
// Lister toutes les collections
// ─────────────────────────────────────────────
export async function getCollections() {
  return prisma.collection.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { products: true } },
    },
  });
}

// ─────────────────────────────────────────────
// Créer une collection
// ─────────────────────────────────────────────
export async function createCollection(formData: FormData) {
  await requireAdmin();

  const raw = {
    name:  formData.get("name")  as string,
    image: formData.get("image") as string | undefined,
  };

  const parsed = CollectionSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const collection = await prisma.collection.create({
    data: {
      name:  parsed.data.name,
      image: parsed.data.image || null,
    },
  });

  revalidatePath("/admin/collections");
  revalidateTag("collections", "default");
  revalidatePath("/collections");
  return { success: true, id: collection.id };
}

// ─────────────────────────────────────────────
// Mettre à jour une collection
// ─────────────────────────────────────────────
export async function updateCollection(id: string, formData: FormData) {
  await requireAdmin();

  const raw = {
    name:  formData.get("name")  as string,
    image: formData.get("image") as string | undefined,
  };

  const parsed = CollectionSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  await prisma.collection.update({
    where: { id },
    data: {
      name:  parsed.data.name,
      image: parsed.data.image || null,
    },
  });

  revalidatePath("/admin/collections");
  revalidateTag("collections", "default");
  revalidatePath(`/admin/collections/${id}/modifier`);
  revalidatePath("/collections");
  revalidatePath(`/collections/${id}`);
  return { success: true };
}

// ─────────────────────────────────────────────
// Supprimer une collection
// ─────────────────────────────────────────────
export async function deleteCollection(id: string) {
  await requireAdmin();

  await prisma.collection.delete({ where: { id } });

  revalidatePath("/admin/collections");
  revalidateTag("collections", "default");
  revalidatePath("/collections");
  return { success: true };
}

// ─────────────────────────────────────────────
// Ajouter un produit à une collection
// ─────────────────────────────────────────────
export async function addProductToCollection(
  collectionId: string,
  productId: string,
  colorId?: string
) {
  await requireAdmin();

  // Position = max actuel + 1
  const maxPos = await prisma.collectionProduct.aggregate({
    where:   { collectionId },
    _max:    { position: true },
  });
  const position = (maxPos._max.position ?? -1) + 1;

  await prisma.collectionProduct.upsert({
    where:  { collectionId_productId: { collectionId, productId } },
    create: { collectionId, productId, colorId: colorId || null, position },
    update: { colorId: colorId || null },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}

// ─────────────────────────────────────────────
// Retirer un produit d'une collection
// ─────────────────────────────────────────────
export async function removeProductFromCollection(
  collectionId: string,
  productId: string
) {
  await requireAdmin();

  await prisma.collectionProduct.delete({
    where: { collectionId_productId: { collectionId, productId } },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}

// ─────────────────────────────────────────────
// Mettre à jour la couleur d'un produit dans une collection
// ─────────────────────────────────────────────
export async function updateCollectionProductColor(
  collectionId: string,
  productId: string,
  colorId: string | null
) {
  await requireAdmin();

  await prisma.collectionProduct.update({
    where: { collectionId_productId: { collectionId, productId } },
    data:  { colorId },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}

// ─────────────────────────────────────────────
// Mettre à jour les positions des produits
// ─────────────────────────────────────────────
export async function reorderCollectionProducts(
  collectionId: string,
  items: { productId: string; position: number }[]
) {
  await requireAdmin();

  await Promise.all(
    items.map(({ productId, position }) =>
      prisma.collectionProduct.update({
        where: { collectionId_productId: { collectionId, productId } },
        data:  { position },
      })
    )
  );

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}

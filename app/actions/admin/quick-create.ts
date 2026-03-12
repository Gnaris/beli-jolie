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

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createColorQuick(
  name: string,
  hex: string | null
): Promise<{ id: string; name: string; hex: string | null }> {
  await requireAdmin();
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Le nom est requis.");

  const color = await prisma.color.create({
    data: { name: trimmedName, hex: hex || null },
    select: { id: true, name: true, hex: true },
  });

  revalidatePath("/admin/couleurs");
  revalidatePath("/admin/produits/nouveau");
  return color;
}

export async function createCategoryQuick(
  name: string
): Promise<{ id: string; name: string; subCategories: { id: string; name: string }[] }> {
  await requireAdmin();
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Le nom est requis.");

  const category = await prisma.category.create({
    data: { name: trimmedName, slug: toSlug(trimmedName) },
    select: { id: true, name: true, subCategories: { select: { id: true, name: true } } },
  });

  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
  return category;
}

export async function createCompositionQuick(
  name: string
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Le nom est requis.");

  const composition = await prisma.composition.create({
    data: { name: trimmedName },
    select: { id: true, name: true },
  });

  revalidatePath("/admin/compositions");
  return composition;
}

export async function createSubCategoryQuick(
  name: string,
  categoryId: string
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Le nom est requis.");
  if (!categoryId) throw new Error("Catégorie parente requise.");

  const subCategory = await prisma.subCategory.create({
    data: { name: trimmedName, slug: toSlug(trimmedName), categoryId },
    select: { id: true, name: true },
  });

  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
  return subCategory;
}

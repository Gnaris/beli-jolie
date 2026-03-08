"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Génère un slug à partir d'un nom */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Vérification admin réutilisable */
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Catégories
// ─────────────────────────────────────────────

export async function createCategory(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");

  await prisma.category.create({
    data: { name, slug: toSlug(name) },
  });
  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
}

export async function deleteCategory(id: string) {
  await requireAdmin();
  await prisma.category.delete({ where: { id } });
  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
}

// ─────────────────────────────────────────────
// Sous-catégories
// ─────────────────────────────────────────────

export async function createSubCategory(formData: FormData) {
  await requireAdmin();
  const name       = (formData.get("name") as string)?.trim();
  const categoryId = formData.get("categoryId") as string;
  if (!name || !categoryId) throw new Error("Nom et catégorie requis.");

  await prisma.subCategory.create({
    data: { name, slug: toSlug(name), categoryId },
  });
  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
}

export async function deleteSubCategory(id: string) {
  await requireAdmin();
  await prisma.subCategory.delete({ where: { id } });
  revalidatePath("/admin/categories");
}

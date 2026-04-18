"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoTranslateCategory, autoTranslateSubCategory } from "@/lib/auto-translate";

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

  const category = await prisma.category.create({
    data: { name, slug: toSlug(name) },
  });
  await autoTranslateCategory(category.id, name);
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
  revalidateTag("sizes", "default");
}

/**
 * Update the PFS category ID for an existing category.
 * Used when linking a BJ category to a PFS category for reverse sync.
 */
export async function updateCategoryPfsId(
  id: string,
  pfsCategoryId: string | null,
  pfsGender?: string | null,
  pfsFamilyId?: string | null,
  pfsFamilyName?: string | null,
) {
  await requireAdmin();
  if (pfsCategoryId) {
    const conflict = await prisma.category.findFirst({
      where: { pfsCategoryId, id: { not: id } },
      select: { id: true, name: true },
    });
    if (conflict) {
      throw new Error(`Cet ID PFS est déjà utilisé par la catégorie « ${conflict.name} ».`);
    }
  }
  await prisma.category.update({
    where: { id },
    data: {
      pfsCategoryId,
      pfsGender: pfsCategoryId ? (pfsGender || null) : null,
      pfsFamilyId: pfsCategoryId ? (pfsFamilyId || null) : null,
      pfsFamilyName: pfsFamilyName?.trim() || null,
    },
  });
  revalidatePath("/admin/produits");
  revalidatePath("/admin/pfs/correspondances");
  revalidateTag("categories", "default");
}

/**
 * Lightweight alternative used by the mapping UI — only updates Genre + Famille
 * (the two fields the Excel exporter actually needs). Leaves the legacy
 * pfsCategoryId/pfsFamilyId in place for the DELETE API path.
 */
export async function updateCategoryPfsTaxonomy(
  id: string,
  pfsGender: string | null,
  pfsFamilyName: string | null,
) {
  await requireAdmin();
  await prisma.category.update({
    where: { id },
    data: {
      pfsGender: pfsGender?.trim() || null,
      pfsFamilyName: pfsFamilyName?.trim() || null,
    },
  });
  revalidatePath("/admin/pfs/correspondances");
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

export async function deleteCategory(id: string) {
  await requireAdmin();
  await prisma.category.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

// ─────────────────────────────────────────────
// Sous-catégories
// ─────────────────────────────────────────────

export async function createSubCategory(formData: FormData) {
  await requireAdmin();
  const name       = (formData.get("name") as string)?.trim();
  const categoryId = formData.get("categoryId") as string;
  if (!name || !categoryId) throw new Error("Nom et catégorie requis.");

  const subCategory = await prisma.subCategory.create({
    data: { name, slug: toSlug(name), categoryId },
  });
  await autoTranslateSubCategory(subCategory.id, name);
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

export async function deleteSubCategory(id: string) {
  await requireAdmin();
  await prisma.subCategory.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

export async function updateCategoryDirect(
  id: string,
  name: string,
  translations: Record<string, string>
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");
  await prisma.category.update({ where: { id }, data: { name: name.trim(), slug: toSlug(name.trim()) } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = translations[locale]?.trim();
    if (val) {
      await prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: id, locale } },
        update: { name: val },
        create: { categoryId: id, locale, name: val },
      });
    } else {
      await prisma.categoryTranslation.deleteMany({ where: { categoryId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

export async function updateSubCategoryDirect(
  id: string,
  name: string,
  translations: Record<string, string>
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");
  await prisma.subCategory.update({ where: { id }, data: { name: name.trim(), slug: toSlug(name.trim()) } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = translations[locale]?.trim();
    if (val) {
      await prisma.subCategoryTranslation.upsert({
        where: { subCategoryId_locale: { subCategoryId: id, locale } },
        update: { name: val },
        create: { subCategoryId: id, locale, name: val },
      });
    } else {
      await prisma.subCategoryTranslation.deleteMany({ where: { subCategoryId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

export async function updateCategory(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");

  await prisma.category.update({ where: { id }, data: { name, slug: toSlug(name) } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = (formData.get(`name_${locale}`) as string)?.trim();
    if (val) {
      await prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: id, locale } },
        update: { name: val },
        create: { categoryId: id, locale, name: val },
      });
    } else {
      await prisma.categoryTranslation.deleteMany({ where: { categoryId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

export async function updateSubCategory(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");

  await prisma.subCategory.update({ where: { id }, data: { name, slug: toSlug(name) } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = (formData.get(`name_${locale}`) as string)?.trim();
    if (val) {
      await prisma.subCategoryTranslation.upsert({
        where: { subCategoryId_locale: { subCategoryId: id, locale } },
        update: { name: val },
        create: { subCategoryId: id, locale, name: val },
      });
    } else {
      await prisma.subCategoryTranslation.deleteMany({ where: { subCategoryId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

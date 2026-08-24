"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoTranslateCategory, autoTranslateSubCategory } from "@/lib/auto-translate";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import {
  buildMappingImpactSummary,
  type MappingChangeSummary,
} from "@/lib/mapping-impact";

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
  const pfsGender = (formData.get("pfsGender") as string)?.trim() || null;
  const pfsFamilyName = (formData.get("pfsFamilyName") as string)?.trim() || null;
  const pfsCategoryName = (formData.get("pfsCategoryName") as string)?.trim() || null;
  if (!name) throw new Error("Le nom est requis.");
  if (!pfsGender || !pfsFamilyName) {
    throw new Error("Le genre et la famille Paris Fashion Shop sont obligatoires.");
  }

  const category = await prisma.category.create({
    data: { name, slug: toSlug(name), pfsGender, pfsFamilyName, pfsCategoryName },
  });
  // Fire-and-forget : la traduction PFS ne doit pas bloquer le retour de la
  // server action (le voile de chargement resterait affiché sinon).
  void autoTranslateCategory(category.id, name);
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
  revalidateTag("categories", "default");
}

/**
 * Lightweight alternative used by the mapping UI — only updates Genre + Famille
 * (the two fields the Excel exporter actually needs). Leaves the legacy
 * pfsCategoryId/pfsFamilyId in place for the DELETE API path.
 *
 * Retourne un `impact` non-null si l'un des trois champs a réellement changé
 * ET si des produits publiés sur PFS utilisent cette catégorie.
 */
export async function updateCategoryPfsTaxonomy(
  id: string,
  pfsGender: string | null,
  pfsFamilyName: string | null,
  pfsCategoryName?: string | null,
): Promise<{ success: true; impact: MappingChangeSummary | null }> {
  await requireAdmin();
  const newGender = pfsGender?.trim() || null;
  const newFamily = pfsFamilyName?.trim() || null;
  const newCategory = pfsCategoryName?.trim() || null;

  const before = await prisma.category.findUnique({
    where: { id },
    select: { name: true, pfsGender: true, pfsFamilyName: true, pfsCategoryName: true },
  });
  if (!before) throw new Error("Catégorie introuvable.");

  await prisma.category.update({
    where: { id },
    data: {
      pfsGender: newGender,
      pfsFamilyName: newFamily,
      pfsCategoryName: newCategory,
    },
  });
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");

  const unchanged =
    before.pfsGender === newGender &&
    before.pfsFamilyName === newFamily &&
    before.pfsCategoryName === newCategory;
  if (unchanged) return { success: true, impact: null };

  const impact = await buildMappingImpactSummary({
    attribute: "category",
    marketplace: "pfs",
    localId: id,
    localName: before.name,
    oldValueLabel: formatPfsTaxonomyLabel(before.pfsGender, before.pfsFamilyName, before.pfsCategoryName),
    newValueLabel: formatPfsTaxonomyLabel(newGender, newFamily, newCategory),
    rollbackFields: {
      pfsGender: before.pfsGender,
      pfsFamilyName: before.pfsFamilyName,
      pfsCategoryName: before.pfsCategoryName,
    },
  });
  return { success: true, impact };
}

function formatPfsTaxonomyLabel(
  gender: string | null,
  family: string | null,
  category: string | null,
): string | null {
  const parts = [gender, family, category].filter((p): p is string => !!p);
  return parts.length ? parts.join(" > ") : null;
}

export async function deleteCategory(id: string) {
  await requireAdmin();
  await prisma.category.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
}

/**
 * Saisie manuelle de l'ID taxonomie Faire (taxonomy_type.id, ex:
 * "tx_jewelry_bracelets") pour une catégorie BJ. La taxonomie Faire est
 * figée et non exposée via API publique — l'admin va chercher l'ID dans
 * son portail brand. Voir docs/faire-api.md §12.
 *
 * Retourne un `impact` non-null si le mapping a réellement changé ET si des
 * produits publiés sur Faire utilisent cette catégorie.
 */
export async function updateCategoryFaireTaxonomy(
  id: string,
  faireTaxonomyId: string | null,
): Promise<{ success: true; impact: MappingChangeSummary | null }> {
  await requireAdmin();
  const normalized = faireTaxonomyId?.trim() || null;

  const before = await prisma.category.findUnique({
    where: { id },
    select: { name: true, faireTaxonomyId: true },
  });
  if (!before) throw new Error("Catégorie introuvable.");

  await prisma.category.update({
    where: { id },
    data: { faireTaxonomyId: normalized },
  });
  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");

  if (before.faireTaxonomyId === normalized) return { success: true, impact: null };

  const impact = await buildMappingImpactSummary({
    attribute: "category",
    marketplace: "faire",
    localId: id,
    localName: before.name,
    oldValueLabel: before.faireTaxonomyId,
    newValueLabel: normalized,
    rollbackFields: { faireTaxonomyId: before.faireTaxonomyId },
  });
  return { success: true, impact };
}

/**
 * Mappe une catégorie BJ vers une feuille standard Orderchamp
 * (`ProductCategoryPath` enum). Envoyé dans `productCreate/Update.category`
 * pour peupler la « Catégorie de marché » côté back-office OC.
 *
 * Retourne un `impact` non-null si le mapping a réellement changé ET que des
 * produits publiés sur Orderchamp utilisent cette catégorie.
 */
export async function updateCategoryOrderchampCategoryPath(
  id: string,
  orderchampCategoryPath: string | null,
): Promise<{ success: true; impact: MappingChangeSummary | null }> {
  await requireAdmin();
  const normalized = orderchampCategoryPath?.trim() || null;

  const before = await prisma.category.findUnique({
    where: { id },
    select: { name: true, orderchampCategoryPath: true },
  });
  if (!before) throw new Error("Catégorie introuvable.");

  await prisma.category.update({
    where: { id },
    data: { orderchampCategoryPath: normalized },
  });
  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");

  if (before.orderchampCategoryPath === normalized) {
    return { success: true, impact: null };
  }

  const impact = await buildMappingImpactSummary({
    attribute: "category",
    marketplace: "orderchamp",
    localId: id,
    localName: before.name,
    oldValueLabel: before.orderchampCategoryPath,
    newValueLabel: normalized,
    rollbackFields: { orderchampCategoryPath: before.orderchampCategoryPath },
  });
  return { success: true, impact };
}

/**
 * Mappe une sous-catégorie BJ vers une feuille standard Orderchamp. Facultatif :
 * si absent, on retombe sur le mapping de la catégorie parente au moment du
 * publish (cf. `resolveOrderchampCategoryForProduct`).
 */
export async function updateSubCategoryOrderchampCategoryPath(
  id: string,
  orderchampCategoryPath: string | null,
) {
  await requireAdmin();
  const normalized = orderchampCategoryPath?.trim() || null;

  const before = await prisma.subCategory.findUnique({
    where: { id },
    select: { orderchampCategoryPath: true, categoryId: true },
  });
  if (!before) throw new Error("Sous-catégorie introuvable.");

  await prisma.subCategory.update({
    where: { id },
    data: { orderchampCategoryPath: normalized },
  });
  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");

  return { success: true };
}

/**
 * Saisie manuelle du code SH douanier Faire pour une catégorie BJ. Le code
 * dépend du type de produit (ex: "7117.19.00" pour bijoux acier,
 * "6109.10.00" pour t-shirts coton, "9004.10" pour lunettes). Stocké par
 * catégorie pour rester générique tous types de produits.
 */
export async function updateCategoryFaireHsCode(
  id: string,
  faireHsCode: string | null,
) {
  await requireAdmin();
  await prisma.category.update({
    where: { id },
    data: { faireHsCode: faireHsCode?.trim() || null },
  });
  revalidatePath("/admin/categories");
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
  // Fire-and-forget : idem, la traduction PFS ne doit pas bloquer le retour.
  void autoTranslateSubCategory(subCategory.id, name);
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

  for (const locale of NON_DEFAULT_LOCALES) {
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

  for (const locale of NON_DEFAULT_LOCALES) {
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

  for (const locale of NON_DEFAULT_LOCALES) {
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

  for (const locale of NON_DEFAULT_LOCALES) {
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

/** Reorder categories by providing an ordered array of ids */
export async function reorderCategories(orderedIds: string[]) {
  await requireAdmin();

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.category.update({ where: { id }, data: { position: index } }),
    ),
  );

  revalidatePath("/admin/produits");
  revalidatePath("/admin/categories");
  revalidateTag("categories", "default");
}

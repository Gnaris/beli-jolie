"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoTranslateColor } from "@/lib/auto-translate";
import { getCachedPfsColors } from "@/lib/cached-data";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import { deleteFile, keyFromDbPath } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { loadAffectedProductMeta, type AffectedProduct } from "./color-merge";

export interface ColorUpdateResult {
  nameChanged: boolean;
  pfsColorRefChanged: boolean;
  affectedProducts: AffectedProduct[];
}

/**
 * A motif file is owned by exactly one Color. Before mutating
 * `Color.patternImage`, callers should purge the previous file via this
 * helper so the disk doesn't accumulate orphan motifs at each replacement.
 *
 * Errors are logged and swallowed: the BDD is the source of truth, an
 * orphan file just wastes a few KB.
 */
async function purgePatternFile(dbPath: string | null | undefined): Promise<void> {
  if (!dbPath) return;
  try {
    await deleteFile(keyFromDbPath(dbPath));
  } catch (err) {
    logger.warn("[colors] Failed to delete old pattern file", { path: dbPath, error: err });
  }
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export async function createColor(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  const hex = (formData.get("hex") as string)?.trim() || null;
  if (!name) throw new Error("Le nom est requis.");

  const existing = await prisma.color.findFirst({
    where: { name: { equals: name } },
    select: { name: true },
  });
  if (existing) {
    throw new Error(`La couleur « ${existing.name} » existe déjà dans la bibliothèque.`);
  }

  const color = await prisma.color.create({ data: { name, hex } });
  autoTranslateColor(color.id, name);
  revalidatePath("/admin/produits");
  revalidateTag("colors", "default");
  revalidatePath("/admin/produits/nouveau");
}

export async function updateColor(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  const hex = (formData.get("hex") as string)?.trim() || null;
  if (!name) throw new Error("Le nom est requis.");

  await prisma.color.update({ where: { id }, data: { name, hex } });

  for (const locale of NON_DEFAULT_LOCALES) {
    const val = (formData.get(`name_${locale}`) as string)?.trim();
    if (val) {
      await prisma.colorTranslation.upsert({
        where: { colorId_locale: { colorId: id, locale } },
        update: { name: val },
        create: { colorId: id, locale, name: val },
      });
    } else {
      await prisma.colorTranslation.deleteMany({ where: { colorId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
  revalidateTag("colors", "default");
}

export async function updateColorDirect(
  id: string,
  name: string,
  hex: string | null,
  translations: Record<string, string>,
  patternImage?: string | null,
  pfsColorRef?: string | null,
): Promise<ColorUpdateResult> {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");

  // Snapshot AVANT pour comparer ce qui a réellement changé (sert au routage marketplace).
  const before = await prisma.color.findUnique({
    where: { id },
    select: { name: true, pfsColorRef: true, patternImage: true },
  });
  if (!before) throw new Error("Couleur introuvable.");

  const newName = name.trim();
  // `pfsColorRef === undefined` = champ non touché par l'appelant : on garde l'ancien.
  const newPfsRef =
    pfsColorRef === undefined ? before.pfsColorRef : pfsColorRef?.trim() || null;
  const nameChanged = before.name !== newName;
  const pfsColorRefChanged = before.pfsColorRef !== newPfsRef;

  const data: { name: string; hex: string | null; patternImage?: string | null; pfsColorRef?: string | null } = {
    name: newName,
    hex: patternImage ? null : hex,
  };
  if (patternImage !== undefined) {
    data.patternImage = patternImage;
  }
  if (pfsColorRef !== undefined) {
    data.pfsColorRef = newPfsRef;
  }

  await prisma.color.update({ where: { id }, data });

  // Old motif is orphan as soon as the new path is stored: purge it.
  if (patternImage !== undefined && before.patternImage && before.patternImage !== patternImage) {
    await purgePatternFile(before.patternImage);
  }

  for (const locale of NON_DEFAULT_LOCALES) {
    const val = translations[locale]?.trim();
    if (val) {
      await prisma.colorTranslation.upsert({
        where: { colorId_locale: { colorId: id, locale } },
        update: { name: val },
        create: { colorId: id, locale, name: val },
      });
    } else {
      await prisma.colorTranslation.deleteMany({ where: { colorId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
  revalidateTag("colors", "default");

  // Pas de scan produit si ni le nom ni la ref PFS n'ont changé : aucune marketplace impactée.
  if (!nameChanged && !pfsColorRefChanged) {
    return { nameChanged: false, pfsColorRefChanged: false, affectedProducts: [] };
  }

  const productIds = await collectProductIdsByColor(id);
  const affectedProducts = await loadAffectedProductMeta(productIds);
  return { nameChanged, pfsColorRefChanged, affectedProducts };
}

async function collectProductIdsByColor(colorId: string): Promise<string[]> {
  const set = new Set<string>();
  const v = await prisma.productColor.findMany({
    where: { colorId },
    select: { productId: true },
    distinct: ["productId"],
  });
  for (const r of v) set.add(r.productId);
  const pl = await prisma.packColorLine.findMany({
    where: { colorId },
    select: { productColor: { select: { productId: true } } },
  });
  for (const r of pl) set.add(r.productColor.productId);
  const pri = await prisma.product.findMany({
    where: { primaryColorId: colorId },
    select: { id: true },
  });
  for (const r of pri) set.add(r.id);
  return [...set];
}

/**
 * Return the live PFS colour list for client dropdowns. Wraps the cached
 * fetcher so client code doesn't import server-only modules.
 */
export async function fetchPfsColorOptions(): Promise<
  { value: string; label: string; hex: string; image: string | null }[]
> {
  await requireAdmin();
  const colors = await getCachedPfsColors();
  return colors.map((c) => ({
    value: c.reference,
    label: c.label,
    hex: c.value,
    image: c.image,
  }));
}

export async function deleteColor(id: string) {
  await requireAdmin();
  const count = await prisma.productColor.count({ where: { colorId: id } });
  if (count > 0) throw new Error("Cette couleur est utilisée par des produits.");
  const previous = await prisma.color.findUnique({
    where: { id },
    select: { patternImage: true },
  });
  await prisma.color.delete({ where: { id } });
  await purgePatternFile(previous?.patternImage ?? null);
  revalidatePath("/admin/produits");
  revalidateTag("colors", "default");
}

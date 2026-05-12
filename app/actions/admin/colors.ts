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
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");

  const data: { name: string; hex: string | null; patternImage?: string | null; pfsColorRef?: string | null } = {
    name: name.trim(),
    hex: patternImage ? null : hex,
  };
  if (patternImage !== undefined) {
    data.patternImage = patternImage;
  }
  if (pfsColorRef !== undefined) {
    data.pfsColorRef = pfsColorRef?.trim() || null;
  }

  // If patternImage is being touched (changed or cleared), remember the old
  // file so we can purge it AFTER the BDD update succeeds.
  let previousPattern: string | null = null;
  if (patternImage !== undefined) {
    const previous = await prisma.color.findUnique({
      where: { id },
      select: { patternImage: true },
    });
    previousPattern = previous?.patternImage ?? null;
  }

  await prisma.color.update({ where: { id }, data });

  // Old motif is orphan as soon as the new path is stored: purge it.
  if (patternImage !== undefined && previousPattern && previousPattern !== patternImage) {
    await purgePatternFile(previousPattern);
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

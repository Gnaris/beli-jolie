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
import {
  buildMappingImpactSummary,
  type MappingChangeSummary,
} from "@/lib/mapping-impact";

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
  // Auto-crée + auto-lie côté Microstore. Silencieux si Microstore hors-ligne.
  const { autoCreateColorOnMicrostore } = await import(
    "@/lib/microstore-attribute-propagation"
  );
  await autoCreateColorOnMicrostore({ colorId: color.id, name });
  revalidatePath("/admin/produits");
  revalidatePath("/admin/couleurs");
  revalidateTag("colors", "default");
  revalidatePath("/admin/produits/nouveau");
}

export async function updateColor(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  const hex = (formData.get("hex") as string)?.trim() || null;
  if (!name) throw new Error("Le nom est requis.");

  const before = await prisma.color.findUnique({
    where: { id },
    select: { name: true },
  });
  await prisma.color.update({ where: { id }, data: { name, hex } });
  if (before && before.name !== name) {
    const { propagateColorRenameToMicrostore } = await import(
      "@/lib/microstore-attribute-propagation"
    );
    await propagateColorRenameToMicrostore({ colorId: id, newName: name });
  }

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
  microstoreColorId?: number | null,
): Promise<void> {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");

  const before = await prisma.color.findUnique({
    where: { id },
    select: { name: true, pfsColorRef: true, patternImage: true, microstoreColorId: true },
  });
  if (!before) throw new Error("Couleur introuvable.");

  const newName = name.trim();
  // `pfsColorRef === undefined` = champ non touché par l'appelant : on garde l'ancien.
  const newPfsRef =
    pfsColorRef === undefined ? before.pfsColorRef : pfsColorRef?.trim() || null;
  const nameChanged = before.name !== newName;

  const data: {
    name: string;
    hex: string | null;
    patternImage?: string | null;
    pfsColorRef?: string | null;
    microstoreColorId?: number | null;
  } = {
    name: newName,
    hex: patternImage ? null : hex,
  };
  if (patternImage !== undefined) {
    data.patternImage = patternImage;
  }
  if (pfsColorRef !== undefined) {
    data.pfsColorRef = newPfsRef;
  }
  if (microstoreColorId !== undefined) {
    data.microstoreColorId = microstoreColorId;
  }

  await prisma.color.update({ where: { id }, data });

  // Propage le renommage vers Microstore si la couleur est déjà liée.
  if (nameChanged) {
    const { propagateColorRenameToMicrostore } = await import(
      "@/lib/microstore-attribute-propagation"
    );
    await propagateColorRenameToMicrostore({ colorId: id, newName });
  }

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
  revalidatePath("/admin/couleurs");
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

/**
 * Update the PFS ref for a color. Multiple colors can share the same PFS ref
 * (ex : deux nuances BJ → une même couleur PFS). Retourne un `impact`
 * non-null si la ref a réellement changé ET si des produits publiés sur PFS
 * utilisent cette couleur.
 */
export async function updateColorPfsRef(
  id: string,
  pfsColorRef: string | null,
): Promise<{ success: true; impact: MappingChangeSummary | null }> {
  await requireAdmin();

  const normalized = pfsColorRef?.trim() || null;

  const before = await prisma.color.findUnique({
    where: { id },
    select: { name: true, pfsColorRef: true },
  });
  if (!before) throw new Error("Couleur introuvable.");

  await prisma.color.update({ where: { id }, data: { pfsColorRef: normalized } });

  revalidatePath("/admin/produits");
  revalidatePath("/admin/couleurs");
  revalidateTag("colors", "default");

  if (before.pfsColorRef === normalized) return { success: true, impact: null };

  const impact = await buildMappingImpactSummary({
    attribute: "color",
    marketplace: "pfs",
    localId: id,
    localName: before.name,
    oldValueLabel: before.pfsColorRef,
    newValueLabel: normalized,
    rollbackFields: { pfsColorRef: before.pfsColorRef },
  });
  return { success: true, impact };
}

/**
 * Mappe une couleur BJ vers un ID couleur Microstore. Envoyé au push produit
 * natif (`lib/microstore-goods-crud.ts`) pour renseigner l'attribut couleur
 * côté MC Gérant.
 */
export async function updateColorMicrostoreMapping(
  id: string,
  microstoreColorId: number | null,
) {
  await requireAdmin();
  await prisma.color.update({
    where: { id },
    data: { microstoreColorId },
  });
  const { findMicrostoreProductsForColorMapping } = await import(
    "@/lib/microstore-mapping-propagation"
  );
  const affectedProducts = await findMicrostoreProductsForColorMapping(id);
  revalidatePath("/admin/couleurs");
  revalidatePath("/admin/produits");
  revalidateTag("colors", "default");
  return { success: true as const, affectedProducts };
}

/** Reorder colors by providing an ordered array of ids */
export async function reorderColors(orderedIds: string[]) {
  await requireAdmin();

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.color.update({ where: { id }, data: { position: index } }),
    ),
  );

  revalidatePath("/admin/produits");
  revalidatePath("/admin/couleurs");
  revalidateTag("colors", "default");
}

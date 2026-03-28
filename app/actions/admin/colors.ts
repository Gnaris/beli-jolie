"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export async function createColor(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  const hex  = (formData.get("hex")  as string)?.trim() || null;
  if (!name) throw new Error("Le nom est requis.");

  await prisma.color.create({ data: { name, hex } });
  revalidatePath("/admin/produits");
  revalidateTag("colors", "default");
  revalidatePath("/admin/produits/nouveau");
}

export async function updateColor(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  const hex  = (formData.get("hex")  as string)?.trim() || null;
  if (!name) throw new Error("Le nom est requis.");

  await prisma.color.update({ where: { id }, data: { name, hex } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
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
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");

  // If patternImage is set, clear hex. If hex is set, clear patternImage.
  const data: { name: string; hex: string | null; patternImage?: string | null } = {
    name: name.trim(),
    hex: patternImage ? null : hex,
  };
  if (patternImage !== undefined) {
    data.patternImage = patternImage;
  }

  await prisma.color.update({ where: { id }, data });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
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
 * Update the PFS color reference for an existing color.
 * Used when linking a BJ color to a PFS color for reverse sync.
 */
export async function updateColorPfsRef(id: string, pfsColorRef: string | null) {
  await requireAdmin();
  if (pfsColorRef) {
    const conflict = await prisma.color.findFirst({
      where: { pfsColorRef, id: { not: id } },
      select: { id: true, name: true },
    });
    if (conflict) {
      throw new Error(`Cette référence PFS est déjà utilisée par la couleur « ${conflict.name} ».`);
    }
  }
  await prisma.color.update({ where: { id }, data: { pfsColorRef } });
  revalidatePath("/admin/produits");
  revalidateTag("colors", "default");
}

/**
 * Fetch PFS colors list + existing BJ→PFS mappings.
 * Used in the color assignment modal for marketplace mapping.
 */
export async function fetchPfsColorsForMapping(): Promise<{
  pfsColors: { reference: string; value: string; image: string | null; label: string }[];
  existingMappings: Record<string, { colorId: string; colorName: string }>;
}> {
  await requireAdmin();

  const { pfsGetColors } = await import("@/lib/pfs-api-write");

  const [pfsColors, mappedColors] = await Promise.all([
    pfsGetColors(),
    prisma.color.findMany({
      where: { pfsColorRef: { not: null } },
      select: { id: true, name: true, pfsColorRef: true },
    }),
  ]);

  const existingMappings: Record<string, { colorId: string; colorName: string }> = {};
  for (const c of mappedColors) {
    if (c.pfsColorRef) {
      existingMappings[c.pfsColorRef] = { colorId: c.id, colorName: c.name };
    }
  }

  return {
    pfsColors: pfsColors.map((c) => ({
      reference: c.reference,
      value: c.value,
      image: c.image,
      label: c.labels?.fr || c.reference,
    })),
    existingMappings,
  };
}

/**
 * Update the PFS color reference override for a ProductColor (variant).
 * Used for multi-color combinations that need to map to a single PFS color.
 */
export async function updateProductColorPfsRef(productColorId: string, pfsColorRef: string | null) {
  await requireAdmin();
  await prisma.productColor.update({
    where: { id: productColorId },
    data: { pfsColorRef: pfsColorRef || null },
  });
  // Pas de revalidateTag ici — le state client se met à jour localement
  // et un revalidate provoquerait un remount du composant
}

/**
 * Get all colors for linking in PFS comparison modal.
 * Returns colors sorted by name, with their current pfsColorRef.
 */
export async function getColorsForLinking(): Promise<
  { id: string; name: string; hex: string | null; patternImage: string | null; pfsColorRef: string | null }[]
> {
  await requireAdmin();
  return prisma.color.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true },
  });
}

export async function deleteColor(id: string) {
  await requireAdmin();
  const count = await prisma.productColor.count({ where: { colorId: id } });
  if (count > 0) throw new Error("Cette couleur est utilisée par des produits.");
  await prisma.color.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidateTag("colors", "default");
}

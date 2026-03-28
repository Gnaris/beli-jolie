"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

export async function createComposition(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  await prisma.composition.create({ data: { name } });
  revalidatePath("/admin/produits");
}

export async function updateComposition(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  await prisma.composition.update({ where: { id }, data: { name } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = (formData.get(`name_${locale}`) as string)?.trim();
    if (val) {
      await prisma.compositionTranslation.upsert({
        where: { compositionId_locale: { compositionId: id, locale } },
        update: { name: val },
        create: { compositionId: id, locale, name: val },
      });
    } else {
      await prisma.compositionTranslation.deleteMany({ where: { compositionId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
}

export async function updateCompositionDirect(
  id: string,
  name: string,
  translations: Record<string, string>
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");
  await prisma.composition.update({ where: { id }, data: { name: name.trim() } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = translations[locale]?.trim();
    if (val) {
      await prisma.compositionTranslation.upsert({
        where: { compositionId_locale: { compositionId: id, locale } },
        update: { name: val },
        create: { compositionId: id, locale, name: val },
      });
    } else {
      await prisma.compositionTranslation.deleteMany({ where: { compositionId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
}

/**
 * Update the PFS composition reference for an existing composition.
 * Used when linking a BJ composition to a PFS composition for reverse sync.
 */
export async function updateCompositionPfsRef(id: string, pfsCompositionRef: string | null) {
  await requireAdmin();
  if (pfsCompositionRef) {
    const conflict = await prisma.composition.findFirst({
      where: { pfsCompositionRef, id: { not: id } },
      select: { id: true, name: true },
    });
    if (conflict) {
      throw new Error(`Cette référence PFS est déjà utilisée par la composition « ${conflict.name} ».`);
    }
  }
  await prisma.composition.update({ where: { id }, data: { pfsCompositionRef } });
  revalidatePath("/admin/produits");
  revalidateTag("compositions", "default");
}

export async function deleteComposition(id: string) {
  await requireAdmin();
  const used = await prisma.productComposition.count({ where: { compositionId: id } });
  if (used > 0) throw new Error("Cette composition est utilisée par des produits.");
  await prisma.composition.delete({ where: { id } });
  revalidatePath("/admin/produits");
}

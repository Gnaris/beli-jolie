"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

export async function createSeason(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  await prisma.season.create({ data: { name } });
  revalidatePath("/admin/saisons");
  revalidateTag("seasons", "default");
}

export async function updateSeason(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  await prisma.season.update({ where: { id }, data: { name } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = (formData.get(`name_${locale}`) as string)?.trim();
    if (val) {
      await prisma.seasonTranslation.upsert({
        where: { seasonId_locale: { seasonId: id, locale } },
        update: { name: val },
        create: { seasonId: id, locale, name: val },
      });
    } else {
      await prisma.seasonTranslation.deleteMany({ where: { seasonId: id, locale } });
    }
  }

  revalidatePath("/admin/saisons");
  revalidateTag("seasons", "default");
}

export async function updateSeasonDirect(
  id: string,
  name: string,
  translations: Record<string, string>
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");
  await prisma.season.update({ where: { id }, data: { name: name.trim() } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = translations[locale]?.trim();
    if (val) {
      await prisma.seasonTranslation.upsert({
        where: { seasonId_locale: { seasonId: id, locale } },
        update: { name: val },
        create: { seasonId: id, locale, name: val },
      });
    } else {
      await prisma.seasonTranslation.deleteMany({ where: { seasonId: id, locale } });
    }
  }

  revalidatePath("/admin/saisons");
  revalidateTag("seasons", "default");
}

/**
 * Update the PFS season reference for an existing season.
 * Used when linking a BJ season to a PFS season for reverse sync.
 */
export async function updateSeasonPfsRef(id: string, pfsSeasonRef: string | null) {
  await requireAdmin();
  if (pfsSeasonRef) {
    const conflict = await prisma.season.findFirst({
      where: { pfsSeasonRef, id: { not: id } },
      select: { id: true, name: true },
    });
    if (conflict) {
      throw new Error(`Cette référence PFS est déjà utilisée par la saison « ${conflict.name} ».`);
    }
  }
  await prisma.season.update({ where: { id }, data: { pfsSeasonRef } });
  revalidatePath("/admin/saisons");
  revalidateTag("seasons", "default");
}

export async function deleteSeason(id: string) {
  await requireAdmin();
  const used = await prisma.product.count({ where: { seasonId: id } });
  if (used > 0) throw new Error("Cette saison est utilisée par des produits.");
  await prisma.season.delete({ where: { id } });
  revalidatePath("/admin/saisons");
  revalidateTag("seasons", "default");
}

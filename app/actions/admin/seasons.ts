"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoTranslateSeason } from "@/lib/auto-translate";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

export async function createSeason(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  const season = await prisma.season.create({ data: { name } });
  autoTranslateSeason(season.id, name);
  revalidatePath("/admin/produits");
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

  revalidatePath("/admin/produits");
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

  revalidatePath("/admin/produits");
  revalidateTag("seasons", "default");
}

/**
 * Replace all PFS refs for a season.
 * Each ref must be unique across all seasons.
 */
export async function updateSeasonPfsRefs(id: string, pfsRefs: string[]) {
  await requireAdmin();

  // Normalize & dedupe
  const normalized = [...new Set(pfsRefs.map((r) => r.trim()).filter(Boolean))];

  // Check for conflicts with other seasons
  if (normalized.length > 0) {
    const conflicts = await prisma.seasonPfsRef.findMany({
      where: { pfsRef: { in: normalized }, seasonId: { not: id } },
      select: { pfsRef: true, season: { select: { name: true } } },
    });
    if (conflicts.length > 0) {
      const detail = conflicts.map((c) => `« ${c.pfsRef} » (${c.season.name})`).join(", ");
      throw new Error(`Correspondances déjà utilisées par d'autres saisons : ${detail}`);
    }
  }

  // Replace all refs for this season in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.seasonPfsRef.deleteMany({ where: { seasonId: id } });
    if (normalized.length > 0) {
      await tx.seasonPfsRef.createMany({
        data: normalized.map((pfsRef) => ({ seasonId: id, pfsRef })),
      });
    }
  });

  revalidatePath("/admin/produits");
  revalidateTag("seasons", "default");
}

/**
 * @deprecated Use updateSeasonPfsRefs instead. Kept for backward compat during migration.
 */
export async function updateSeasonPfsRef(id: string, pfsSeasonRef: string | null) {
  await updateSeasonPfsRefs(id, pfsSeasonRef ? [pfsSeasonRef] : []);
}

export async function deleteSeason(id: string) {
  await requireAdmin();
  const used = await prisma.product.count({ where: { seasonId: id } });
  if (used > 0) throw new Error("Cette saison est utilisée par des produits.");
  await prisma.season.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidateTag("seasons", "default");
}

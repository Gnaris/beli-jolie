"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoTranslateComposition } from "@/lib/auto-translate";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import {
  buildMappingImpactSummary,
  type MappingChangeSummary,
} from "@/lib/mapping-impact";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

export async function createComposition(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  const composition = await prisma.composition.create({ data: { name } });
  autoTranslateComposition(composition.id, name);
  revalidatePath("/admin/produits");
}

export async function updateComposition(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  await prisma.composition.update({ where: { id }, data: { name } });

  for (const locale of NON_DEFAULT_LOCALES) {
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
  translations: Record<string, string>,
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");
  await prisma.composition.update({ where: { id }, data: { name: name.trim() } });

  for (const locale of NON_DEFAULT_LOCALES) {
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
 *
 * Retourne un `impact` non-null si le mapping a réellement changé ET si des
 * produits publiés sur PFS utilisent cette composition.
 */
export async function updateCompositionPfsRef(
  id: string,
  pfsCompositionRef: string | null,
): Promise<{ success: true; impact: MappingChangeSummary | null }> {
  await requireAdmin();
  const normalized = pfsCompositionRef?.trim() || null;
  if (normalized) {
    const conflict = await prisma.composition.findFirst({
      where: { pfsCompositionRef: normalized, id: { not: id } },
      select: { id: true, name: true },
    });
    if (conflict) {
      throw new Error(`Cette référence PFS est déjà utilisée par la composition « ${conflict.name} ».`);
    }
  }
  const before = await prisma.composition.findUnique({
    where: { id },
    select: { name: true, pfsCompositionRef: true },
  });
  if (!before) throw new Error("Composition introuvable.");

  await prisma.composition.update({ where: { id }, data: { pfsCompositionRef: normalized } });
  revalidatePath("/admin/produits");
  revalidateTag("compositions", "default");

  if (before.pfsCompositionRef === normalized) return { success: true, impact: null };

  const impact = await buildMappingImpactSummary({
    attribute: "composition",
    marketplace: "pfs",
    localId: id,
    localName: before.name,
    oldValueLabel: before.pfsCompositionRef,
    newValueLabel: normalized,
    rollbackFields: { pfsCompositionRef: before.pfsCompositionRef },
  });
  return { success: true, impact };
}

export async function deleteComposition(id: string) {
  await requireAdmin();
  const used = await prisma.productComposition.count({ where: { compositionId: id } });
  if (used > 0) throw new Error("Cette composition est utilisée par des produits.");
  await prisma.composition.delete({ where: { id } });
  revalidatePath("/admin/produits");
}

/** Reorder compositions by providing an ordered array of ids */
export async function reorderCompositions(orderedIds: string[]) {
  await requireAdmin();

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.composition.update({ where: { id }, data: { position: index } }),
    ),
  );

  revalidatePath("/admin/produits");
  revalidatePath("/admin/compositions");
  revalidateTag("compositions", "default");
}

"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

export async function createManufacturingCountry(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  const isoCode = (formData.get("isoCode") as string)?.trim() || null;
  await prisma.manufacturingCountry.create({ data: { name, isoCode } });
  revalidatePath("/admin/pays");
  revalidateTag("manufacturing-countries", "default");
}

export async function updateManufacturingCountry(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  const isoCode = (formData.get("isoCode") as string)?.trim() || null;
  await prisma.manufacturingCountry.update({ where: { id }, data: { name, isoCode } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = (formData.get(`name_${locale}`) as string)?.trim();
    if (val) {
      await prisma.manufacturingCountryTranslation.upsert({
        where: { manufacturingCountryId_locale: { manufacturingCountryId: id, locale } },
        update: { name: val },
        create: { manufacturingCountryId: id, locale, name: val },
      });
    } else {
      await prisma.manufacturingCountryTranslation.deleteMany({ where: { manufacturingCountryId: id, locale } });
    }
  }

  revalidatePath("/admin/pays");
  revalidateTag("manufacturing-countries", "default");
}

export async function updateManufacturingCountryDirect(
  id: string,
  name: string,
  isoCode: string | null,
  translations: Record<string, string>
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");
  await prisma.manufacturingCountry.update({ where: { id }, data: { name: name.trim(), isoCode } });

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
    const val = translations[locale]?.trim();
    if (val) {
      await prisma.manufacturingCountryTranslation.upsert({
        where: { manufacturingCountryId_locale: { manufacturingCountryId: id, locale } },
        update: { name: val },
        create: { manufacturingCountryId: id, locale, name: val },
      });
    } else {
      await prisma.manufacturingCountryTranslation.deleteMany({ where: { manufacturingCountryId: id, locale } });
    }
  }

  revalidatePath("/admin/pays");
  revalidateTag("manufacturing-countries", "default");
}

export async function updateManufacturingCountryPfsRef(id: string, pfsCountryRef: string | null) {
  await requireAdmin();
  if (pfsCountryRef) {
    const conflict = await prisma.manufacturingCountry.findFirst({
      where: { pfsCountryRef, id: { not: id } },
      select: { id: true, name: true },
    });
    if (conflict) {
      throw new Error(`Cette référence PFS est déjà utilisée par le pays « ${conflict.name} ».`);
    }
  }
  await prisma.manufacturingCountry.update({ where: { id }, data: { pfsCountryRef } });
  revalidatePath("/admin/pays");
  revalidateTag("manufacturing-countries", "default");
}

export async function deleteManufacturingCountry(id: string) {
  await requireAdmin();
  const used = await prisma.product.count({ where: { manufacturingCountryId: id } });
  if (used > 0) throw new Error("Ce pays est utilisé par des produits.");
  await prisma.manufacturingCountry.delete({ where: { id } });
  revalidatePath("/admin/pays");
  revalidateTag("manufacturing-countries", "default");
}

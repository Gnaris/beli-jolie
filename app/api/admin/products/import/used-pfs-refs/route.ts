/**
 * GET /api/admin/products/import/used-pfs-refs
 *
 * Returns PFS references already assigned to existing attributes in the DB.
 * Used during import to avoid assigning the same PFS ref to two different local attributes.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listManufacturingCountries } from "@/lib/countries";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const [colors, categories, compositions, seasons] = await Promise.all([
    prisma.color.findMany({
      select: { name: true },
    }),
    prisma.category.findMany({
      where: { pfsCategoryId: { not: null } },
      select: { name: true, pfsCategoryId: true },
    }),
    prisma.composition.findMany({
      where: { pfsCompositionRef: { not: null } },
      select: { name: true, pfsCompositionRef: true },
    }),
    prisma.season.findMany({
      where: { pfsRef: { not: null } },
      select: { name: true, pfsRef: true },
    }),
  ]);
  const countries = listManufacturingCountries().filter((c) => c.pfsCountryRef);

  return NextResponse.json({
    color: colors.map((c) => ({ ref: c.name, name: c.name })),
    category: categories.map((c) => ({ ref: c.pfsCategoryId!, name: c.name })),
    composition: compositions.map((c) => ({ ref: c.pfsCompositionRef!, name: c.name })),
    country: countries.map((c) => ({ ref: c.pfsCountryRef!, name: c.name })),
    season: seasons.map((c) => ({ ref: c.pfsRef!, name: c.name })),
  });
}

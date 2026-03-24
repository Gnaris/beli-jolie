import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const [colors, categories, compositions, countries, seasons, sizes] = await Promise.all([
    prisma.color.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, pfsCategoryId: true, pfsGender: true, pfsFamilyId: true },
    }),
    prisma.composition.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, pfsCompositionRef: true },
    }),
    prisma.manufacturingCountry.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isoCode: true, pfsCountryRef: true },
    }),
    prisma.season.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, pfsSeasonRef: true },
    }),
    prisma.size.findMany({
      orderBy: { position: "asc" },
      select: {
        id: true, name: true,
        pfsMappings: { select: { pfsSizeRef: true } },
        categories: { select: { category: { select: { name: true } } } },
      },
    }),
  ]);

  return NextResponse.json({ colors, categories, compositions, countries, seasons, sizes });
}

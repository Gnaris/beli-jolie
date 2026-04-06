import { redirect } from "next/navigation";
import Link from "next/link";
import { getCachedPfsEnabled } from "@/lib/cached-data";
import { prisma } from "@/lib/prisma";
import PfsMappingClient from "@/components/pfs/PfsMappingClient";

export default async function PfsCorrespondancesPage() {
  const pfsEnabled = await getCachedPfsEnabled();
  if (!pfsEnabled) redirect("/admin/pfs");

  const [colors, categories, compositions, countries, seasons, sizes, multiColorVariants] = await Promise.all([
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
      select: { id: true, name: true, pfsRef: true },
    }),
    prisma.size.findMany({
      orderBy: { position: "asc" },
      select: {
        id: true, name: true,
        pfsMappings: { select: { pfsSizeRef: true } },
        categories: { select: { category: { select: { name: true } } } },
      },
    }),
    prisma.productColor.findMany({
      where: {
        saleType: "UNIT",
        subColors: { some: {} },
        colorId: { not: null },
      },
      select: {
        id: true,
        pfsColorRef: true,
        color: { select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true } },
        subColors: {
          select: { color: { select: { id: true, name: true, hex: true, patternImage: true } }, position: true },
          orderBy: { position: "asc" },
        },
        product: { select: { id: true, name: true, reference: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-2 text-sm font-body text-text-muted mb-2">
        <Link href="/admin/pfs" className="hover:text-text-primary transition-colors">Paris Fashion Shop</Link>
        <span>/</span>
        <span className="text-text-secondary">Correspondances</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Correspondances Paris Fashion Shop</h1>
          <p className="page-subtitle">
            Liez chaque attribut de votre boutique à son équivalent Paris Fashion Shop. Tous les attributs doivent avoir une correspondance pour pouvoir importer.
          </p>
        </div>
        <Link href="/admin/pfs" className="btn-secondary text-sm shrink-0">
          Retour
        </Link>
      </div>

      <PfsMappingClient
        colors={colors}
        categories={categories}
        compositions={compositions}
        countries={countries}
        seasons={seasons}
        sizes={sizes}
        multiColorVariants={multiColorVariants.filter((v): v is typeof v & { color: NonNullable<typeof v.color> } => v.color !== null)}
      />
    </div>
  );
}

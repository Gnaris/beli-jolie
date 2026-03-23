import { prisma } from "@/lib/prisma";
import PfsMappingClient from "@/components/pfs/PfsMappingClient";

export default async function PfsMappingPage() {
  const [colors, categories, compositions, countries, seasons] = await Promise.all([
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
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Mapping PFS</h1>
        <p className="page-subtitle">
          Liez chaque couleur, catégorie, composition, pays et saison à son équivalent Paris Fashion Shop pour activer la synchronisation automatique.
        </p>
      </div>
      <PfsMappingClient
        colors={colors}
        categories={categories}
        compositions={compositions}
        countries={countries}
        seasons={seasons}
      />
    </div>
  );
}

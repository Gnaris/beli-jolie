import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { getPfsAnnexes } from "@/lib/marketplace-excel/pfs-annexes";
import PfsMappingClient from "@/components/admin/pfs-mapping/PfsMappingClient";

export const metadata: Metadata = {
  title: "Correspondances PFS",
};

export default async function PfsCorrespondancesPage() {
  const [annexes, categories, colors, compositions, countries, seasons, sizes] = await Promise.all([
    getPfsAnnexes(),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, pfsGender: true, pfsFamilyName: true },
    }),
    prisma.color.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true },
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
        id: true,
        name: true,
        pfsMappings: { select: { pfsSizeRef: true } },
      },
    }),
  ]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Correspondances Paris Fashion Shop</h1>
        <p className="page-subtitle font-body">
          Associez chaque attribut de votre catalogue à sa valeur officielle dans le
          modèle Excel PFS. Ces correspondances sont utilisées lors de l&apos;export marketplace
          pour produire un fichier directement uploadable sur Paris Fashion Shop.
        </p>
      </div>

      <PfsMappingClient
        annexes={{
          families: annexes.families,
          categories: annexes.categories,
          colors: annexes.colors,
          compositions: annexes.compositions,
          countries: annexes.countries,
          sizes: annexes.sizes,
        }}
        data={{
          categories,
          colors,
          compositions,
          countries,
          seasons,
          sizes: sizes.map((s) => ({
            id: s.id,
            name: s.name,
            pfsRefs: s.pfsMappings.map((m) => m.pfsSizeRef),
          })),
        }}
      />
    </div>
  );
}

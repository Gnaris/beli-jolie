import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import PageHeader from "@/components/admin/shared/PageHeader";
import CountriesMasterDetail, { type CountryItem } from "@/components/admin/manufacturing-countries/CountriesMasterDetail";
import CountriesHeaderActions from "@/components/admin/manufacturing-countries/CountriesHeaderActions";
import { getEfashionLabelMaps, resolveProvenanceLabel } from "@/lib/efashion-labels";

export const metadata: Metadata = { title: "Pays de fabrication" };

export default async function PaysPage() {
  const [countries, efashionLabels] = await Promise.all([
    prisma.manufacturingCountry.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true } },
        translations: true,
      },
    }),
    getEfashionLabelMaps(),
  ]);

  const items: CountryItem[] = countries.map((c) => ({
    id: c.id,
    name: c.name,
    isoCode: c.isoCode,
    pfsCountryRef: c.pfsCountryRef,
    efashionProvenanceId: c.efashionProvenanceId,
    efashionProvenanceLabel: resolveProvenanceLabel(efashionLabels, c.efashionProvenanceId),
    faireCountryCode: c.faireCountryCode ?? null,
    productCount: c._count.products,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  const translateItems = countries.map((c) => ({
    id: c.id,
    text: c.name,
    hasTranslations: c.translations.length > 0,
  }));

  return (
    <div className="max-w-[1400px] mx-auto space-y-5 px-4 md:px-6 py-6">
      <PageHeader
        eyebrow="Catalogue · Attributs"
        title="Pays de fabrication"
        subtitle="Origine géographique de vos produits, avec mappings marketplaces (PFS, eFashion, Faire) et traductions."
        actions={<CountriesHeaderActions items={translateItems} />}
      />

      <CountriesMasterDetail initialCountries={items} />
    </div>
  );
}

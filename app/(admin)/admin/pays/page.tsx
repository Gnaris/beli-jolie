import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import ManufacturingCountriesManager from "@/components/admin/manufacturing-countries/ManufacturingCountriesManager";

export const metadata: Metadata = { title: "Pays de fabrication" };

export default async function PaysPage() {
  const countries = await prisma.manufacturingCountry.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
    },
  });

  const countryItems = countries.map((c) => ({
    id: c.id,
    name: c.name,
    isoCode: c.isoCode,
    pfsCountryRef: c.pfsCountryRef,
    productCount: c._count.products,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-body text-text-muted mb-1">
            <Link href="/admin" className="hover:text-text-primary transition-colors">Admin</Link>
            <span>/</span>
            <span className="text-text-secondary">Pays de fabrication</span>
          </div>
          <h1 className="page-title">Pays de fabrication</h1>
          <p className="page-subtitle">
            Gérez les pays de fabrication de vos produits.
          </p>
        </div>
        <EntityCreateButton type="country" label="+ Créer un pays" />
      </div>

      <ManufacturingCountriesManager initialCountries={countryItems} />
    </div>
  );
}

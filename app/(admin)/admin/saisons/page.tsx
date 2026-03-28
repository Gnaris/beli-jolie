import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import SeasonsManager from "@/components/admin/seasons/SeasonsManager";

export const metadata: Metadata = { title: "Saisons" };

export default async function SaisonsPage() {
  const seasons = await prisma.season.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
      pfsRefs: { select: { pfsRef: true } },
    },
  });

  const seasonItems = seasons.map((s) => ({
    id: s.id,
    name: s.name,
    pfsRefs: s.pfsRefs.map((r) => r.pfsRef),
    productCount: s._count.products,
    translations: Object.fromEntries(s.translations.map((t) => [t.locale, t.name])),
  }));

  const allUsedPfsRefs = seasonItems.flatMap((s) => s.pfsRefs);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-muted mb-1">
            <Link href="/admin" className="hover:text-text-primary transition-colors">Admin</Link>
            <span>/</span>
            <span className="text-text-secondary">Saisons</span>
          </div>
          <h1 className="page-title">Saisons</h1>
          <p className="page-subtitle">
            Gérez les saisons / collections de vos produits (ex: Printemps/Été 2026).
          </p>
        </div>
        <EntityCreateButton type="season" label="+ Créer une saison" usedPfsRefs={allUsedPfsRefs} />
      </div>

      <SeasonsManager initialSeasons={seasonItems} allUsedPfsRefs={allUsedPfsRefs} />
    </div>
  );
}

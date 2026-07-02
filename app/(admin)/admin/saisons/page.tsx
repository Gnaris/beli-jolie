import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import PageHeader from "@/components/admin/shared/PageHeader";
import SeasonsHeaderActions from "@/components/admin/seasons/SeasonsHeaderActions";
import SeasonsMasterDetail, { type SeasonRow } from "@/components/admin/seasons/SeasonsMasterDetail";
import {
  getCachedHasPfsConfig,
  getCachedHasEfashionConfig,
} from "@/lib/cached-data";
import { getEfashionLabelMaps, resolveCollectionLabel } from "@/lib/efashion-labels";
import { buildTranslationsMap } from "@/lib/translations";

export const metadata: Metadata = { title: "Saisons" };

export default async function SaisonsPage() {
  const [seasons, efashionLabels, hasPfsConfig, hasEfashionConfig] = await Promise.all([
    prisma.season.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true } },
        translations: true,
      },
    }),
    getEfashionLabelMaps(),
    getCachedHasPfsConfig(),
    getCachedHasEfashionConfig(),
  ]);

  const rows: SeasonRow[] = seasons.map((s) => ({
    id: s.id,
    name: s.name,
    translations: buildTranslationsMap(s.name, s.translations),
    pfsRef: s.pfsRef,
    efashionCollectionId: s.efashionCollectionId,
    efashionLabel: resolveCollectionLabel(efashionLabels, s.efashionCollectionId) ?? null,
    productCount: s._count.products,
    createdAt: s.createdAt,
  }));

  const allTranslateItems = seasons.map((s) => ({
    id: s.id,
    text: s.name,
    hasTranslations: s.translations.length > 0,
  }));

  return (
    <div className="max-w-[1400px] mx-auto space-y-5 px-4 md:px-6 py-6">
      <PageHeader
        eyebrow="Catalogue · Collections"
        title="Saisons"
        subtitle="Créez les saisons ici, puis assignez-les à vos produits."
        actions={<SeasonsHeaderActions items={allTranslateItems} />}
      />

      <SeasonsMasterDetail
        seasons={rows}
        hasPfsConfig={hasPfsConfig}
        hasEfashionConfig={hasEfashionConfig}
      />
    </div>
  );
}

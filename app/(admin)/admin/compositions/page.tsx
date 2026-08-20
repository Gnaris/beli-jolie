import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import PageHeader from "@/components/admin/shared/PageHeader";
import CompositionsHeaderActions from "@/components/admin/compositions/CompositionsHeaderActions";
import CompositionsMasterDetail, { type CompositionRow } from "@/components/admin/compositions/CompositionsMasterDetail";
import {
  getCachedHasPfsConfig,
  getCachedHasEfashionConfig,
} from "@/lib/cached-data";
import { getEfashionLabelMaps, resolveCompositionLabel } from "@/lib/efashion-labels";
import { buildTranslationsMap } from "@/lib/translations";

export const metadata: Metadata = { title: "Bibliothèque de compositions" };

export default async function CompositionsPage() {
  const [compositions, efashionLabels, hasPfsConfig, hasEfashionConfig] = await Promise.all([
    prisma.composition.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { products: true } },
        translations: true,
      },
    }),
    getEfashionLabelMaps(),
    getCachedHasPfsConfig(),
    getCachedHasEfashionConfig(),
  ]);

  const rows: CompositionRow[] = compositions.map((c) => ({
    id: c.id,
    name: c.name,
    translations: buildTranslationsMap(c.name, c.translations),
    pfsCompositionRef: c.pfsCompositionRef,
    efashionId: c.efashionId,
    efashionLabel: resolveCompositionLabel(efashionLabels, c.efashionId) ?? null,
    productCount: c._count.products,
    position: c.position,
    createdAt: c.createdAt,
  }));

  const allTranslateItems = compositions.map((c) => ({
    id: c.id,
    text: c.name,
    hasTranslations: c.translations.length > 0,
  }));

  return (
    <div className="max-w-[1400px] mx-auto space-y-5 px-4 md:px-6 py-6">
      <PageHeader
        eyebrow="Catalogue · Matériaux"
        title="Compositions"
        subtitle="Créez les matériaux ici."
        actions={<CompositionsHeaderActions items={allTranslateItems} />}
      />

      <CompositionsMasterDetail
        compositions={rows}
        hasPfsConfig={hasPfsConfig}
        hasEfashionConfig={hasEfashionConfig}
      />
    </div>
  );
}

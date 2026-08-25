import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import PageHeader from "@/components/admin/shared/PageHeader";
import ColorsHeaderActions from "@/components/admin/couleurs/ColorsHeaderActions";
import ColorsMasterDetail, { type ColorRow } from "@/components/admin/couleurs/ColorsMasterDetail";
import {
  getCachedPfsEnabled,
  getCachedAnkorstoreEnabled,
  getCachedHasPfsConfig,
  getCachedHasEfashionConfig,
} from "@/lib/cached-data";
import { getEfashionLabelMaps, resolveColorLabel } from "@/lib/efashion-labels";
import { buildTranslationsMap } from "@/lib/translations";

export const metadata: Metadata = { title: "Bibliothèque de couleurs" };

export default async function CouleursPage() {
  const [colors, pfsEnabled, ankorstoreEnabled, efashionLabels, hasPfsConfig, hasEfashionConfig] = await Promise.all([
    prisma.color.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { productColors: true } },
        translations: true,
      },
    }),
    getCachedPfsEnabled(),
    getCachedAnkorstoreEnabled(),
    getEfashionLabelMaps(),
    getCachedHasPfsConfig(),
    getCachedHasEfashionConfig(),
  ]);

  // Compte de partage par pfsColorRef : combien d'autres couleurs pointent
  // sur le même mapping PFS. Sert à un badge info dans la carte marketplace
  // (non bloquant — un override secondaire résout le conflit côté produit).
  const pfsRefCount = new Map<string, number>();
  for (const c of colors) {
    if (c.pfsColorRef) {
      pfsRefCount.set(c.pfsColorRef, (pfsRefCount.get(c.pfsColorRef) ?? 0) + 1);
    }
  }

  const rows: ColorRow[] = colors.map((c) => ({
    id: c.id,
    name: c.name,
    hex: c.hex,
    patternImage: c.patternImage,
    translations: buildTranslationsMap(c.name, c.translations),
    pfsColorRef: c.pfsColorRef,
    pfsSharedCount: c.pfsColorRef ? Math.max(0, (pfsRefCount.get(c.pfsColorRef) ?? 1) - 1) : 0,
    efashionColorId: c.efashionColorId,
    efashionLabel: resolveColorLabel(efashionLabels, c.efashionColorId) ?? null,
    microstoreColorId: c.microstoreColorId,
    productCount: c._count.productColors,
    position: c.position,
    createdAt: c.createdAt,
  }));

  const allTranslateItems = colors.map((c) => ({
    id: c.id,
    text: c.name,
    hasTranslations: c.translations.length > 0,
  }));

  return (
    <div className="max-w-[1400px] mx-auto space-y-5 px-4 md:px-6 py-6">
      <PageHeader
        eyebrow="Catalogue"
        title="Couleurs"
        subtitle="Créez les couleurs ici, puis assignez-les à vos produits."
        actions={<ColorsHeaderActions items={allTranslateItems} />}
      />

      <ColorsMasterDetail
        colors={rows}
        hasPfsConfig={hasPfsConfig}
        hasEfashionConfig={hasEfashionConfig}
        pfsEnabled={pfsEnabled}
        ankorstoreEnabled={ankorstoreEnabled}
      />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/admin/shared/PageHeader";
import ColorsHeaderActions from "@/components/admin/couleurs/ColorsHeaderActions";
import ColorsMasterDetail, { type ColorRow } from "@/components/admin/couleurs/ColorsMasterDetail";
import {
  getCachedHasPfsConfig,
  getCachedHasEfashionConfig,
  getCachedPfsColors,
} from "@/lib/cached-data";
import { getEfashionLabelMaps, resolveColorLabel } from "@/lib/efashion-labels";
import {
  getMicrostoreLabelMaps,
  resolveMicrostoreLabelOrOrphan,
} from "@/lib/microstore-labels";
import { buildTranslationsMap } from "@/lib/translations";

export default async function CouleursView() {
  const [
    colors,
    efashionLabels,
    microstoreLabels,
    pfsLiveColors,
    hasPfsConfig,
    hasEfashionConfig,
  ] = await Promise.all([
    prisma.color.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { productColors: true } },
        translations: true,
      },
    }),
    getEfashionLabelMaps(),
    getMicrostoreLabelMaps(),
    getCachedPfsColors().catch(() => []),
    getCachedHasPfsConfig(),
    getCachedHasEfashionConfig(),
  ]);

  const pfsColorLabelByRef = new Map<string, string>();
  for (const c of pfsLiveColors) pfsColorLabelByRef.set(c.reference, c.label);

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
    pfsLabel: c.pfsColorRef
      ? pfsColorLabelByRef.get(c.pfsColorRef) ?? c.pfsColorRef
      : null,
    pfsSharedCount: c.pfsColorRef ? Math.max(0, (pfsRefCount.get(c.pfsColorRef) ?? 1) - 1) : 0,
    efashionColorId: c.efashionColorId,
    efashionLabel: resolveColorLabel(efashionLabels, c.efashionColorId) ?? null,
    microstoreColorId: c.microstoreColorId,
    microstoreLabel: resolveMicrostoreLabelOrOrphan(
      microstoreLabels.colors,
      c.microstoreColorId,
    ),
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
    <div className="space-y-5">
      <PageHeader
        title="Couleurs"
        actions={<ColorsHeaderActions items={allTranslateItems} />}
      />
      <ColorsMasterDetail
        colors={rows}
        hasPfsConfig={hasPfsConfig}
        hasEfashionConfig={hasEfashionConfig}
      />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Bibliothèque de couleurs" };

export default async function CouleursPage() {
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
    // Résout ref PFS → libellé français (getCachedPfsColors renvoie déjà
    // `labels.fr` en priorité). Fallback [] silencieux si PFS hors-ligne.
    getCachedPfsColors().catch(() => []),
    getCachedHasPfsConfig(),
    getCachedHasEfashionConfig(),
  ]);

  const pfsColorLabelByRef = new Map<string, string>();
  for (const c of pfsLiveColors) pfsColorLabelByRef.set(c.reference, c.label);

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
    // Libellé PFS français si le référentiel live est joignable, sinon
    // fallback sur la ref brute (comportement historique).
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
      />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import CompositionsManager from "@/components/admin/compositions/CompositionsManager";
import { getEfashionLabelMaps, resolveCompositionLabel } from "@/lib/efashion-labels";

export const metadata: Metadata = { title: "Compositions" };

export default async function CompositionsPage() {
  const [compositions, efashionLabels] = await Promise.all([
    prisma.composition.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true } },
        translations: true,
      },
    }),
    getEfashionLabelMaps(),
  ]);

  const compositionItems = compositions.map((c) => ({
    id: c.id,
    name: c.name,
    pfsCompositionRef: c.pfsCompositionRef,
    efashionId: c.efashionId,
    efashionLabel: resolveCompositionLabel(efashionLabels, c.efashionId),
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
            <span className="text-text-secondary">Compositions</span>
          </div>
          <h1 className="page-title">Bibliothèque de compositions</h1>
          <p className="page-subtitle">
            Créez les matériaux et compositions — ils seront assignables aux produits avec un pourcentage.
          </p>
        </div>
        <EntityCreateButton type="composition" label="+ Créer une composition" />
      </div>

      <CompositionsManager initialCompositions={compositionItems} />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import ColorsManager from "@/components/admin/couleurs/ColorsManager";
import { getCachedPfsEnabled, getCachedAnkorstoreEnabled } from "@/lib/cached-data";

export const metadata: Metadata = { title: "Bibliothèque de couleurs" };

export default async function CouleursPage() {
  const [colors, pfsEnabled, ankorstoreEnabled] = await Promise.all([
    prisma.color.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { productColors: true } },
        translations: true,
      },
    }),
    getCachedPfsEnabled(),
    getCachedAnkorstoreEnabled(),
  ]);

  // Compte de partage par pfsColorRef : combien d'autres couleurs pointent
  // sur le même mapping PFS principal. Sert à afficher un badge informatif
  // (les utilisateurs peuvent quand même publier — un override secondaire
  // résout le conflit côté produit).
  const pfsRefCount = new Map<string, number>();
  for (const c of colors) {
    if (c.pfsColorRef) {
      pfsRefCount.set(c.pfsColorRef, (pfsRefCount.get(c.pfsColorRef) ?? 0) + 1);
    }
  }

  const colorItems = colors.map((c) => ({
    id: c.id,
    name: c.name,
    hex: c.hex,
    patternImage: c.patternImage,
    pfsColorRef: c.pfsColorRef,
    pfsSharedCount: c.pfsColorRef ? Math.max(0, (pfsRefCount.get(c.pfsColorRef) ?? 1) - 1) : 0,
    efashionColorId: c.efashionColorId,
    productCount: c._count.productColors,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">Bibliothèque de couleurs</h1>
          <p className="page-subtitle">
            Créez les couleurs ici, puis assignez-les à vos produits.
          </p>
        </div>
        <EntityCreateButton type="color" label="+ Créer une couleur" />
      </div>

      {/* Liste */}
      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold text-text-secondary uppercase tracking-wider border-b border-border pb-2">
          Couleurs ({colors.length})
        </h2>
        <ColorsManager
          initialColors={colorItems}
          pfsEnabled={pfsEnabled}
          ankorstoreEnabled={ankorstoreEnabled}
        />
      </section>
    </div>
  );
}

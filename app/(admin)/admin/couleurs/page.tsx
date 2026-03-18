import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import ColorsManager from "@/components/admin/couleurs/ColorsManager";

export const metadata: Metadata = { title: "Bibliothèque de couleurs" };

export default async function CouleursPage() {
  const colors = await prisma.color.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { productColors: true } },
      translations: true,
    },
  });

  const colorItems = colors.map((c) => ({
    id: c.id,
    name: c.name,
    hex: c.hex,
    productCount: c._count.productColors,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Bibliothèque de couleurs</h1>
        <p className="page-subtitle">
          Créez les couleurs ici, puis assignez-les à vos produits.
        </p>
      </div>

      {/* Création */}
      <section className="card p-6 flex items-center justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary">
            Nouvelle couleur
          </h2>
          <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
            Saisissez le nom dans toutes les langues souhaitées.
          </p>
        </div>
        <EntityCreateButton type="color" label="+ Créer une couleur" />
      </section>

      {/* Liste */}
      <section className="space-y-2">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-secondary uppercase tracking-wider border-b border-border pb-2">
          Couleurs ({colors.length})
        </h2>
        <ColorsManager initialColors={colorItems} />
      </section>
    </div>
  );
}

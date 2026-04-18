import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import SizesManager from "@/components/admin/tailles/SizesManager";

export const metadata: Metadata = { title: "Gestion des tailles" };

export default async function TaillesPage() {
  const [sizes, categories] = await Promise.all([
    prisma.size.findMany({
      orderBy: { position: "asc" },
      include: {
        categories: {
          include: { category: { select: { id: true, name: true } } },
        },
        pfsMappings: { select: { pfsSizeRef: true } },
        _count: { select: { variantSizes: true } },
      },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const sizeItems = sizes.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    variantCount: s._count.variantSizes,
    categoryIds: s.categories.map((c) => c.category.id),
    categoryNames: s.categories.map((c) => c.category.name),
    pfsMappings: s.pfsMappings.map((m) => m.pfsSizeRef),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Gestion des tailles</h1>
        <p className="page-subtitle">
          Créez les tailles et associez-les aux catégories de produits.
        </p>
      </div>

      <SizesManager
        initialSizes={sizeItems}
        categories={categories}
        pfsEnabled={false}
        pfsSizes={[]}
      />
    </div>
  );
}

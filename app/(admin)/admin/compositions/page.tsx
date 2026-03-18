import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import CompositionsManager from "@/components/admin/compositions/CompositionsManager";

export const metadata: Metadata = { title: "Compositions" };

export default async function CompositionsPage() {
  const compositions = await prisma.composition.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
    },
  });

  const compositionItems = compositions.map((c) => ({
    id: c.id,
    name: c.name,
    productCount: c._count.products,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-muted mb-1">
          <Link href="/admin" className="hover:text-text-primary transition-colors">Admin</Link>
          <span>/</span>
          <span className="text-text-secondary">Compositions</span>
        </div>
        <h1 className="page-title">Bibliothèque de compositions</h1>
        <p className="page-subtitle">
          Créez les matériaux (acier 316L, or 18K…) — ils seront assignables aux produits avec un pourcentage.
        </p>
      </div>

      {/* Création */}
      <div className="card p-6 flex items-center justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary">
            Nouvelle composition
          </h2>
          <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
            Saisissez le nom dans toutes les langues souhaitées.
          </p>
        </div>
        <EntityCreateButton type="composition" label="+ Créer une composition" />
      </div>

      <CompositionsManager initialCompositions={compositionItems} />
    </div>
  );
}

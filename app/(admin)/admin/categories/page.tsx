import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import {
  createCategory,
  deleteCategory,
} from "@/app/actions/admin/categories";
import DeleteButton from "@/components/admin/categories/DeleteButton";
import CategoriesManager from "@/components/admin/categories/SubCategoryList";

export const metadata: Metadata = {
  title: "Catégories",
};

export default async function CategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      subCategories: { orderBy: { name: "asc" } },
      _count: { select: { products: true } },
    },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* En-tête */}
      <div>
        <h1 className="page-title">
          Catégories &amp; sous-catégories
        </h1>
        <p className="page-subtitle font-[family-name:var(--font-roboto)]">
          Organisez votre catalogue produits
        </p>
      </div>

      {/* Formulaire création catégorie */}
      <div className="bg-white border border-[#E5E5E5] rounded-xl p-5">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3 font-[family-name:var(--font-roboto)]">
          Nouvelle categorie
        </p>
        <form action={createCategory} className="flex gap-2">
          <input
            type="text"
            name="name"
            placeholder="Nom de la categorie..."
            required
            className="flex-1 field-input"
          />
          <button
            type="submit"
            className="btn-primary whitespace-nowrap"
          >
            Ajouter
          </button>
        </form>
      </div>

      {/* Gestionnaire catégories + sous-catégories */}
      <CategoriesManager categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        productCount: c._count.products,
        subCategories: c.subCategories.map((s) => ({ id: s.id, name: s.name })),
      }))} />

      {/* Zone suppression catégories */}
      {categories.length > 0 && (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-5">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3 font-[family-name:var(--font-roboto)]">
            Supprimer une categorie
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 bg-bg-secondary border border-border px-3 py-2 rounded-lg">
                <span className="text-sm text-text-primary font-[family-name:var(--font-roboto)]">
                  {cat.name}
                </span>
                <DeleteButton
                  action={deleteCategory.bind(null, cat.id)}
                  confirmMessage={`Supprimer la categorie "${cat.name}" et toutes ses sous-categories ?`}
                  disabled={cat._count.products > 0}
                  disabledTitle="Impossible : des produits sont lies"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

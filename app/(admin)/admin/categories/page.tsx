import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { deleteCategory } from "@/app/actions/admin/categories";
import DeleteButton from "@/components/admin/categories/DeleteButton";
import CategoriesManager from "@/components/admin/categories/SubCategoryList";
import EntityCreateButton from "@/components/admin/EntityCreateButton";

export const metadata: Metadata = {
  title: "Catégories",
};

export default async function CategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      subCategories: {
        orderBy: { name: "asc" },
        include: { translations: true },
      },
      translations: true,
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
        <p className="page-subtitle font-body">
          Organisez votre catalogue produits
        </p>
      </div>

      {/* Création catégorie */}
      <div className="bg-bg-primary border border-border rounded-xl p-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary font-heading">Nouvelle catégorie</p>
          <p className="text-xs text-text-muted font-body mt-0.5">
            Saisissez le nom dans toutes les langues souhaitées.
          </p>
        </div>
        <EntityCreateButton type="category" label="+ Créer une catégorie" />
      </div>

      {/* Gestionnaire catégories + sous-catégories */}
      <CategoriesManager categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        pfsGender: c.pfsGender,
        pfsFamilyName: c.pfsFamilyName,
        pfsCategoryName: c.pfsCategoryName,
        productCount: c._count.products,
        translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
        subCategories: c.subCategories.map((s) => ({
          id: s.id,
          name: s.name,
          translations: Object.fromEntries(s.translations.map((t) => [t.locale, t.name])),
        })),
      }))} />

      {/* Zone suppression catégories */}
      {categories.length > 0 && (
        <div className="bg-bg-primary border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3 font-body">
            Supprimer une categorie
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 bg-bg-secondary border border-border px-3 py-2 rounded-lg">
                <span className="text-sm text-text-primary font-body">
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

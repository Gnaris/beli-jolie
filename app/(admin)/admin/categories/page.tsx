import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import {
  createCategory,
  deleteCategory,
  createSubCategory,
  deleteSubCategory,
} from "@/app/actions/admin/categories";
import DeleteButton from "@/components/admin/categories/DeleteButton";

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
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A]">
          Catégories &amp; sous-catégories
        </h1>
        <p className="text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)] mt-0.5">
          Organisez votre catalogue produits
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* ── Colonne gauche : Catégories ─────────────────────────── */}
        <section className="space-y-4">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#475569] uppercase tracking-wider border-b border-[#E2E8F0] pb-2">
            Catégories principales
          </h2>

          {/* Formulaire création */}
          <form action={createCategory} className="flex gap-2">
            <input
              type="text"
              name="name"
              placeholder="Nouvelle catégorie…"
              required
              className="flex-1 field-input"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-[#0F3460] text-white text-sm font-[family-name:var(--font-poppins)] font-semibold hover:bg-[#0A2540] transition-colors whitespace-nowrap"
            >
              Ajouter
            </button>
          </form>

          {/* Liste */}
          {categories.length === 0 ? (
            <p className="text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)] py-4 text-center border border-dashed border-[#E2E8F0]">
              Aucune catégorie
            </p>
          ) : (
            <ul className="space-y-1">
              {categories.map((cat) => (
                <li
                  key={cat.id}
                  className="flex items-center justify-between bg-white border border-[#E2E8F0] px-3 py-2.5"
                >
                  <div>
                    <span className="text-sm font-medium text-[#0F172A] font-[family-name:var(--font-roboto)]">
                      {cat.name}
                    </span>
                    <span className="ml-2 text-xs text-[#94A3B8]">
                      {cat._count.products} produit{cat._count.products > 1 ? "s" : ""}
                      {" · "}
                      {cat.subCategories.length} sous-cat.
                    </span>
                  </div>
                  <DeleteButton
                    action={deleteCategory.bind(null, cat.id)}
                    confirmMessage={`Supprimer la catégorie "${cat.name}" ?`}
                    disabled={cat._count.products > 0}
                    disabledTitle="Impossible : des produits sont liés"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Colonne droite : Sous-catégories ──────────────────────── */}
        <section className="space-y-4">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#475569] uppercase tracking-wider border-b border-[#E2E8F0] pb-2">
            Sous-catégories
          </h2>

          {/* Formulaire création */}
          <form action={createSubCategory} className="space-y-2">
            <select
              name="categoryId"
              required
              className="w-full field-input"
              defaultValue=""
            >
              <option value="" disabled>— Catégorie parente —</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="text"
                name="name"
                placeholder="Nouvelle sous-catégorie…"
                required
                className="flex-1 field-input"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-[#0F3460] text-white text-sm font-[family-name:var(--font-poppins)] font-semibold hover:bg-[#0A2540] transition-colors whitespace-nowrap"
              >
                Ajouter
              </button>
            </div>
          </form>

          {/* Liste groupée par catégorie */}
          {categories.every((c) => c.subCategories.length === 0) ? (
            <p className="text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)] py-4 text-center border border-dashed border-[#E2E8F0]">
              Aucune sous-catégorie
            </p>
          ) : (
            <div className="space-y-3">
              {categories
                .filter((c) => c.subCategories.length > 0)
                .map((cat) => (
                  <div key={cat.id}>
                    <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1 font-[family-name:var(--font-roboto)]">
                      {cat.name}
                    </p>
                    <ul className="space-y-1">
                      {cat.subCategories.map((sub) => (
                        <li
                          key={sub.id}
                          className="flex items-center justify-between bg-white border border-[#E2E8F0] px-3 py-2"
                        >
                          <span className="text-sm text-[#0F172A] font-[family-name:var(--font-roboto)]">
                            {sub.name}
                          </span>
                          <DeleteButton
                            action={deleteSubCategory.bind(null, sub.id)}
                            confirmMessage={`Supprimer "${sub.name}" ?`}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

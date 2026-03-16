"use client";

import { useState } from "react";
import DeleteButton from "./DeleteButton";
import { createSubCategory, deleteSubCategory } from "@/app/actions/admin/categories";

interface Category {
  id: string;
  name: string;
  productCount: number;
  subCategories: { id: string; name: string }[];
}

export default function CategoriesManager({ categories }: { categories: Category[] }) {
  const [activeCatId, setActiveCatId] = useState<string | null>(null);

  const activeCat = categories.find((c) => c.id === activeCatId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

      {/* -- Colonne gauche : Catégories principales -- */}
      <section className="space-y-4">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-secondary uppercase tracking-wider border-b border-border pb-2">
          Categories principales
        </h2>

        {categories.length === 0 ? (
          <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] py-4 text-center border border-dashed border-border rounded-xl">
            Aucune categorie
          </p>
        ) : (
          <ul className="space-y-1">
            {categories.map((cat) => {
              const isActive = activeCatId === cat.id;
              return (
                <li key={cat.id}>
                  <button
                    type="button"
                    onClick={() => setActiveCatId(isActive ? null : cat.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors text-left ${
                      isActive
                        ? "bg-[#1A1A1A] text-white"
                        : "bg-bg-primary border border-border hover:bg-bg-secondary"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <svg className={`w-4 h-4 shrink-0 transition-transform ${isActive ? "rotate-90 text-white" : "text-text-muted"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className={`text-sm font-medium font-[family-name:var(--font-roboto)] truncate ${isActive ? "text-white" : "text-text-primary"}`}>
                        {cat.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-[family-name:var(--font-roboto)] ${isActive ? "text-white/70" : "text-text-muted"}`}>
                        {cat.subCategories.length} sous-cat. · {cat.productCount} produit{cat.productCount > 1 ? "s" : ""}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* -- Colonne droite : Sous-catégories de la catégorie sélectionnée -- */}
      <section className="space-y-4">
        {!activeCat ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 bg-bg-tertiary rounded-full flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
              </svg>
            </div>
            <p className="text-sm font-[family-name:var(--font-poppins)] font-semibold text-text-primary">
              Selectionnez une categorie
            </p>
            <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-1">
              Cliquez sur une categorie a gauche pour voir et gerer ses sous-categories.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-secondary uppercase tracking-wider">
                {activeCat.name}
              </h2>
              <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                {activeCat.subCategories.length} sous-categorie{activeCat.subCategories.length > 1 ? "s" : ""}
              </span>
            </div>

            {/* Formulaire ajout */}
            <form action={createSubCategory} className="space-y-2">
              <input type="hidden" name="categoryId" value={activeCat.id} />
              <div className="flex gap-2">
                <input
                  type="text"
                  name="name"
                  placeholder="Nouvelle sous-categorie..."
                  required
                  className="flex-1 field-input"
                />
                <button
                  type="submit"
                  className="btn-primary whitespace-nowrap"
                >
                  Ajouter
                </button>
              </div>
            </form>

            {/* Liste */}
            {activeCat.subCategories.length === 0 ? (
              <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] py-6 text-center border border-dashed border-border rounded-xl">
                Aucune sous-categorie pour cette categorie
              </p>
            ) : (
              <ul className="space-y-1">
                {activeCat.subCategories.map((sub) => (
                  <li
                    key={sub.id}
                    className="flex items-center justify-between bg-bg-primary border border-border px-3 py-2.5 rounded-xl"
                  >
                    <span className="text-sm text-text-primary font-[family-name:var(--font-roboto)]">
                      {sub.name}
                    </span>
                    <DeleteButton
                      action={deleteSubCategory.bind(null, sub.id)}
                      confirmMessage={`Supprimer "${sub.name}" ?`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

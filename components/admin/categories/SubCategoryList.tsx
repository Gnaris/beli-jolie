"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DeleteButton from "./DeleteButton";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import EntityEditModal from "@/components/admin/EntityEditModal";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import {
  deleteSubCategory,
  updateCategoryDirect,
  updateCategoryPfsId,
  updateSubCategoryDirect,
} from "@/app/actions/admin/categories";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import TranslateAllButton from "@/components/admin/TranslateAllButton";

interface SubCategoryItem {
  id: string;
  name: string;
  translations: Record<string, string>;
}

interface Category {
  id: string;
  name: string;
  pfsCategoryId: string | null;
  pfsGender: string | null;
  pfsFamilyId: string | null;
  productCount: number;
  translations: Record<string, string>;
  subCategories: SubCategoryItem[];
}

export default function CategoriesManager({ categories }: { categories: Category[] }) {
  const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editSub, setEditSub] = useState<SubCategoryItem | null>(null);
  const [editPfsCategoryId, setEditPfsCategoryId] = useState("");
  const [editPfsGender, setEditPfsGender] = useState<string | null>(null);
  const [editPfsFamilyId, setEditPfsFamilyId] = useState<string | null>(null);
  const router = useRouter();

  const activeCat = categories.find((c) => c.id === activeCatId);

  function openEditCat(cat: Category) {
    setEditCat(cat);
    setEditPfsCategoryId(cat.pfsCategoryId ?? "");
    setEditPfsGender(cat.pfsGender ?? null);
    setEditPfsFamilyId(cat.pfsFamilyId ?? null);
  }

  async function handleSaveCat(name: string, translations: Record<string, string>) {
    if (!editCat) return;
    await updateCategoryDirect(editCat.id, name, translations);
    const origPfsCatId = editCat.pfsCategoryId ?? "";
    if (editPfsCategoryId !== origPfsCatId) {
      await updateCategoryPfsId(
        editCat.id,
        editPfsCategoryId || null,
        editPfsGender,
        editPfsFamilyId,
      );
    }
    router.refresh();
  }

  async function handleSaveSub(name: string, translations: Record<string, string>) {
    if (!editSub || !activeCatId) return;
    await updateSubCategoryDirect(editSub.id, name, translations);
    router.refresh();
  }

  // Build items for "Tout traduire" — categories + all subcategories
  const allTranslateItems = [
    ...categories.map((c) => ({
      id: `cat:${c.id}`,
      text: c.name,
      hasTranslations: Object.keys(c.translations).length > 0,
    })),
    ...categories.flatMap((c) =>
      c.subCategories.map((s) => ({
        id: `sub:${s.id}`,
        text: s.name,
        hasTranslations: Object.keys(s.translations).length > 0,
      }))
    ),
  ];

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    const catItems: { id: string; translations: Record<string, string> }[] = [];
    const subItems: { id: string; translations: Record<string, string> }[] = [];

    for (const [key, t] of Object.entries(translations)) {
      if (key.startsWith("cat:")) {
        catItems.push({ id: key.slice(4), translations: t });
      } else if (key.startsWith("sub:")) {
        subItems.push({ id: key.slice(4), translations: t });
      }
    }

    if (catItems.length > 0) await batchUpdateTranslations("category", catItems);
    if (subItems.length > 0) await batchUpdateTranslations("subcategory", subItems);
    router.refresh();
  }

  return (
    <>
      {/* Tout traduire */}
      <div className="flex justify-end mb-4">
        <TranslateAllButton
          items={allTranslateItems}
          onTranslated={handleTranslateAll}
          label="Tout traduire"
          onlyMissing
        />
      </div>

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
                const subCatWarnings = cat.subCategories.filter(
                  (sub) => Object.keys(sub.translations).length === 0
                );
                const hasSubCatWarning = subCatWarnings.length > 0;
                return (
                  <li key={cat.id}>
                    <div className={`flex flex-col rounded-xl transition-colors ${
                        isActive
                          ? "bg-[#1A1A1A] text-white"
                          : "bg-bg-primary border border-border hover:bg-bg-secondary"
                      }`}>
                      <div className="flex items-center justify-between px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setActiveCatId(isActive ? null : cat.id)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      >
                        <svg className={`w-4 h-4 shrink-0 transition-transform ${isActive ? "rotate-90 text-white" : "text-text-muted"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className={`text-sm font-medium font-[family-name:var(--font-roboto)] truncate ${isActive ? "text-white" : "text-text-primary"}`}>
                          {cat.name}
                        </span>
                        {Object.keys(cat.translations).length === 0 && (
                          <span className="relative group/tw shrink-0" onClick={(e) => e.stopPropagation()}>
                            <span className={`flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold cursor-default select-none ${isActive ? "bg-amber-200/30 border-amber-400 text-amber-200" : "bg-amber-100 border-amber-300 text-amber-700"}`}>⚠</span>
                            <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tw:block z-50 pointer-events-none">
                              <span className="block w-44 bg-[#1A1A1A] text-white text-xs rounded-xl px-3 py-2 shadow-xl">
                                Aucune traduction configurée
                                <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                              </span>
                            </span>
                          </span>
                        )}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-xs font-[family-name:var(--font-roboto)] ${isActive ? "text-white/70" : "text-text-muted"}`}>
                          {cat.subCategories.length} sous-cat. · {cat.productCount} produit{cat.productCount > 1 ? "s" : ""}
                        </span>
                        {hasSubCatWarning && (
                          <span
                            className="relative group/subwarn shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className={`flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold cursor-default select-none ${isActive ? "bg-amber-200/30 border-amber-400 text-amber-200" : "bg-amber-100 border-amber-300 text-amber-700"}`}>
                              ⚠
                            </span>
                            <span className="absolute right-0 bottom-full mb-2 hidden group-hover/subwarn:block z-50 pointer-events-none">
                              <span className="block w-52 bg-[#1A1A1A] text-white text-xs rounded-xl px-3 py-2.5 shadow-xl">
                                <span className="font-semibold block mb-1">Sous-catégories sans traduction</span>
                                <span className="flex flex-col gap-0.5">
                                  {subCatWarnings.map((sub) => (
                                    <span key={sub.id} className="text-white/70">· {sub.name}</span>
                                  ))}
                                </span>
                                <span className="absolute top-full right-3 border-4 border-transparent border-t-[#1A1A1A]" />
                              </span>
                            </span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openEditCat(cat); }}
                          className={`p-1 rounded transition-colors ${isActive ? "hover:bg-white/20 text-white/80 hover:text-white" : "hover:bg-bg-tertiary text-text-muted hover:text-text-primary"}`}
                          title="Modifier"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                      </div>
                      </div>
                      {/* PFS mapping badge */}
                      {cat.pfsCategoryId && (
                        <div className="px-4 pb-2.5 -mt-1">
                          <span className={`badge text-[10px] ${isActive ? "bg-purple-500/30 text-purple-200 border-purple-400/40" : "badge-purple"}`}>
                            PFS: {cat.pfsCategoryId.slice(0, 12)}…
                          </span>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* -- Colonne droite : Sous-catégories -- */}
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
                <div>
                  <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-secondary uppercase tracking-wider">
                    {activeCat.name}
                  </h2>
                  <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                    {activeCat.subCategories.length} sous-categorie{activeCat.subCategories.length > 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSubModalOpen(true)}
                  className="btn-primary text-sm whitespace-nowrap"
                >
                  + Créer
                </button>
              </div>

              {activeCat.subCategories.length === 0 ? (
                <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] py-6 text-center border border-dashed border-border rounded-xl">
                  Aucune sous-categorie pour cette categorie
                </p>
              ) : (
                <ul className="space-y-1">
                  {activeCat.subCategories.map((sub) => (
                    <li key={sub.id} className="flex items-center justify-between bg-bg-primary border border-border px-3 py-2.5 rounded-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary font-[family-name:var(--font-roboto)]">
                          {sub.name}
                        </span>
                        {Object.keys(sub.translations).length === 0 && (
                          <span className="relative group/tw shrink-0">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[10px] font-bold cursor-default select-none">⚠</span>
                            <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tw:block z-50 pointer-events-none">
                              <span className="block w-44 bg-[#1A1A1A] text-white text-xs rounded-xl px-3 py-2 shadow-xl">
                                Aucune traduction configurée
                                <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                              </span>
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditSub(sub)}
                          className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                          title="Modifier"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                        <DeleteButton
                          action={deleteSubCategory.bind(null, sub.id)}
                          confirmMessage={`Supprimer "${sub.name}" ?`}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>

      {/* Modal création sous-catégorie */}
      {activeCatId && (
        <QuickCreateModal
          type="subcategory"
          open={subModalOpen}
          onClose={() => setSubModalOpen(false)}
          onCreated={() => { setSubModalOpen(false); router.refresh(); }}
          categoryId={activeCatId}
        />
      )}

      {/* Modale édition catégorie */}
      <EntityEditModal
        open={!!editCat}
        onClose={() => setEditCat(null)}
        title="Modifier la catégorie"
        initialName={editCat?.name ?? ""}
        initialTranslations={editCat?.translations ?? {}}
        renderExtra={
          editCat ? (
            <MarketplaceMappingSection
              entityType="category"
              pfsCategoryId={editPfsCategoryId}
              onPfsCategoryChange={(catId, gender, familyId) => {
                setEditPfsCategoryId(catId);
                setEditPfsGender(gender);
                setEditPfsFamilyId(familyId);
              }}
            />
          ) : undefined
        }
        onSave={handleSaveCat}
      />

      {/* Modale édition sous-catégorie */}
      <EntityEditModal
        open={!!editSub}
        onClose={() => setEditSub(null)}
        title="Modifier la sous-catégorie"
        initialName={editSub?.name ?? ""}
        initialTranslations={editSub?.translations ?? {}}
        onSave={handleSaveSub}
      />
    </>
  );
}

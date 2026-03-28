"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import DeleteButton from "./DeleteButton";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import {
  deleteCategory,
  deleteSubCategory,
  updateCategoryDirect,
  updateCategoryPfsId,
  updateSubCategoryDirect,
} from "@/app/actions/admin/categories";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import { useConfirm } from "@/components/ui/ConfirmDialog";

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

export default function CategoriesManager({ categories, pfsCategoryNames = {} }: { categories: Category[]; pfsCategoryNames?: Record<string, string> }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [subModalCatId, setSubModalCatId] = useState<string | null>(null);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editSub, setEditSub] = useState<{ sub: SubCategoryItem; catId: string } | null>(null);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const { confirm } = useConfirm();

  const filtered = search.trim()
    ? categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : categories;

  function openEditCat(cat: Category) {
    setEditCat(cat);
  }

  async function handleDeleteCat(cat: Category) {
    if (cat.productCount > 0) return;
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette catégorie ?",
      message: `La catégorie "${cat.name}" et toutes ses sous-catégories seront définitivement supprimées.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    await deleteCategory(cat.id);
    router.refresh();
  }

  async function handleSaveCat(
    name: string,
    translations: Record<string, string>,
    _hex?: string,
    _patternImage?: string | null,
    pfs?: { ref?: string; categoryId?: string; categoryGender?: string | null; categoryFamilyId?: string | null },
  ) {
    if (!editCat) return;
    await updateCategoryDirect(editCat.id, name, translations);
    const newPfsCatId = pfs?.categoryId || null;
    if (newPfsCatId !== (editCat.pfsCategoryId ?? null)) {
      await updateCategoryPfsId(
        editCat.id,
        newPfsCatId,
        pfs?.categoryGender ?? null,
        pfs?.categoryFamilyId ?? null,
      );
    }
    router.refresh();
  }

  async function handleSaveSub(name: string, translations: Record<string, string>) {
    if (!editSub) return;
    await updateSubCategoryDirect(editSub.sub.id, name, translations);
    router.refresh();
  }

  // Build items for "Tout traduire"
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

  const GENDER_LABELS: Record<string, string> = {
    WOMAN: "Femme",
    MAN: "Homme",
    KID: "Enfant",
    SUPPLIES: "Fournitures",
  };

  return (
    <>
      {/* Recherche + Tout traduire */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une catégorie…"
            className="field-input w-full sm:w-[28rem]"
            style={{ paddingLeft: "2.25rem" }}
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <TranslateAllButton
          items={allTranslateItems}
          onTranslated={handleTranslateAll}
          label="Tout traduire"
          onlyMissing
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted font-body py-6 text-center border border-dashed border-border rounded-xl">
          {search.trim() ? "Aucune catégorie trouvée" : "Aucune catégorie"}
        </p>
      ) : (
        <div className="border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3 w-8"></th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Nom</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Sous-cat.</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Produits</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Traduction</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3 hidden md:table-cell">PFS</th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((cat) => {
                  const isExpanded = expandedId === cat.id;
                  const subCatWarnings = cat.subCategories.filter(
                    (sub) => Object.keys(sub.translations).length === 0
                  );
                  const hasCatTranslation = Object.keys(cat.translations).length > 0;

                  return (
                    <Fragment key={cat.id}>
                      {/* Category row */}
                      <tr
                        className={`transition-colors cursor-pointer ${isExpanded ? "bg-bg-secondary" : "hover:bg-bg-secondary/50"}`}
                        onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                      >
                        {/* Chevron */}
                        <td className="px-4 py-3">
                          <svg
                            className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        {/* Nom */}
                        <td className="px-4 py-3">
                          <span className="font-medium text-text-primary">{cat.name}</span>
                        </td>
                        {/* Sous-cat count */}
                        <td className="px-4 py-3 text-center">
                          <span className="badge badge-neutral text-[10px]">{cat.subCategories.length}</span>
                          {subCatWarnings.length > 0 && (
                            <span className="relative group/subwarn inline-flex ml-1" onClick={(e) => e.stopPropagation()}>
                              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[8px] font-bold cursor-default select-none">⚠</span>
                              <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/subwarn:block z-50 pointer-events-none">
                                <span className="block w-52 bg-bg-dark text-text-inverse text-xs rounded-xl px-3 py-2.5 shadow-xl">
                                  <span className="font-semibold block mb-1">Sous-catégories sans traduction</span>
                                  <span className="flex flex-col gap-0.5">
                                    {subCatWarnings.map((sub) => (
                                      <span key={sub.id} className="text-white/70">· {sub.name}</span>
                                    ))}
                                  </span>
                                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                                </span>
                              </span>
                            </span>
                          )}
                        </td>
                        {/* Produits count */}
                        <td className="px-4 py-3 text-center">
                          <span className="badge badge-neutral text-[10px]">{cat.productCount}</span>
                        </td>
                        {/* Traduction */}
                        <td className="px-4 py-3 text-center hidden sm:table-cell">
                          {hasCatTranslation ? (
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700 text-[9px] mx-auto">✓</span>
                          ) : (
                            <span className="relative group/tw inline-flex">
                              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold cursor-default select-none">⚠</span>
                              <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tw:block z-50 pointer-events-none">
                                <span className="block w-40 bg-bg-dark text-text-inverse text-[11px] rounded-xl px-2.5 py-1.5 shadow-xl">
                                  Aucune traduction
                                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                                </span>
                              </span>
                            </span>
                          )}
                        </td>
                        {/* PFS */}
                        <td className="px-4 py-3 hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                          {cat.pfsCategoryId ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="badge badge-purple text-[10px]">
                                PFS: {pfsCategoryNames[cat.pfsCategoryId] || cat.pfsCategoryId}
                              </span>
                              {cat.pfsGender && (
                                <span className="text-[10px] text-text-muted">
                                  {GENDER_LABELS[cat.pfsGender] ?? cat.pfsGender}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-text-muted text-xs">—</span>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={() => openEditCat(cat)}
                              className="p-2 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-bg-secondary"
                              title="Modifier"
                              aria-label={`Modifier la catégorie ${cat.name}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCat(cat)}
                              disabled={cat.productCount > 0}
                              title={cat.productCount > 0 ? "Impossible — utilisée par des produits" : "Supprimer"}
                              aria-label={`Supprimer la catégorie ${cat.name}`}
                              className="p-2 text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-bg-secondary"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Subcategory drawer */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <div className="bg-bg-tertiary/50 border-t border-border px-6 py-4">
                              <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-heading">
                                  Sous-catégories de {cat.name}
                                </h3>
                                <button
                                  type="button"
                                  onClick={() => { setSubModalCatId(cat.id); setSubModalOpen(true); }}
                                  className="btn-primary text-xs py-1.5 px-3"
                                >
                                  + Créer
                                </button>
                              </div>

                              {cat.subCategories.length === 0 ? (
                                <p className="text-sm text-text-muted font-body py-4 text-center border border-dashed border-border rounded-xl bg-bg-primary">
                                  Aucune sous-catégorie
                                </p>
                              ) : (
                                <div className="border border-border rounded-xl overflow-hidden bg-bg-primary">
                                  <table className="w-full text-sm font-body">
                                    <tbody className="divide-y divide-border">
                                      {cat.subCategories.map((sub) => (
                                        <tr key={sub.id} className="hover:bg-bg-secondary/50 transition-colors">
                                          <td className="px-4 py-2.5">
                                            <span className="text-text-primary">{sub.name}</span>
                                          </td>
                                          <td className="px-4 py-2.5 text-center w-20">
                                            {Object.keys(sub.translations).length === 0 ? (
                                              <span className="relative group/tw inline-flex">
                                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold cursor-default select-none">⚠</span>
                                                <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tw:block z-50 pointer-events-none">
                                                  <span className="block w-40 bg-bg-dark text-text-inverse text-[11px] rounded-xl px-2.5 py-1.5 shadow-xl">
                                                    Aucune traduction
                                                    <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                                                  </span>
                                                </span>
                                              </span>
                                            ) : (
                                              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700 text-[9px] mx-auto">✓</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-2.5 w-24">
                                            <div className="flex items-center justify-end gap-0.5">
                                              <button
                                                type="button"
                                                onClick={() => setEditSub({ sub, catId: cat.id })}
                                                className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-bg-secondary"
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
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal création sous-catégorie */}
      {subModalCatId && (
        <QuickCreateModal
          type="subcategory"
          open={subModalOpen}
          onClose={() => setSubModalOpen(false)}
          onCreated={() => { setSubModalOpen(false); router.refresh(); }}
          categoryId={subModalCatId}
        />
      )}

      {/* Modale édition catégorie */}
      {editCat && (
        <QuickCreateModal
          type="category"
          open={!!editCat}
          onClose={() => setEditCat(null)}
          onCreated={() => { setEditCat(null); router.refresh(); }}
          editMode={{
            id: editCat.id,
            name: editCat.name,
            translations: editCat.translations,
            pfsCategoryId: editCat.pfsCategoryId,
            pfsCategoryGender: editCat.pfsGender,
            pfsCategoryFamilyId: editCat.pfsFamilyId,
            onSave: handleSaveCat,
          }}
        />
      )}

      {/* Modale édition sous-catégorie */}
      {editSub && (
        <QuickCreateModal
          type="subcategory"
          open={!!editSub}
          onClose={() => setEditSub(null)}
          onCreated={() => { setEditSub(null); router.refresh(); }}
          categoryId={editSub.catId}
          editMode={{
            id: editSub.sub.id,
            name: editSub.sub.name,
            translations: editSub.sub.translations,
            onSave: handleSaveSub,
          }}
        />
      )}
    </>
  );
}


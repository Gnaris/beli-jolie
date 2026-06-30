"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import CategoriesList from "./CategoriesList";
import CategoryDetail, { type CategoryDetailData } from "./CategoryDetail";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  deleteCategory,
  deleteSubCategory,
  updateCategoryDirect,
  updateCategoryPfsTaxonomy,
  updateCategoryFaireTaxonomy,
  updateSubCategoryDirect,
} from "@/app/actions/admin/categories";

type Sub = { id: string; name: string; translations: Record<string, string> };

export type CategoryRow = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsGender: string | null;
  pfsFamilyName: string | null;
  pfsCategoryName: string | null;
  efashionCategorieId: number | null;
  faireTaxonomyId: string | null;
  productCount: number;
  createdAt: Date;
  subCategories: Sub[];
  pfsLabel: string | null;
  efashionLabel: string | null;
  faireLabel: string | null;
};

type Props = {
  categories: CategoryRow[];
  hasPfsConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
};

export default function CategoriesMasterDetail({
  categories,
  hasPfsConfig,
  hasEfashionConfig,
  hasFaireConfig,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const urlSelectedId = searchParams.get("cat");
  const initialDesktopId = categories[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(urlSelectedId ?? initialDesktopId);
  const [editCat, setEditCat] = useState<CategoryRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [subModalCatId, setSubModalCatId] = useState<string | null>(null);
  const [editSub, setEditSub] = useState<{ sub: Sub; catId: string } | null>(null);
  const [editFocusMarketplace, setEditFocusMarketplace] = useState<"pfs" | "efashion" | "faire" | undefined>(undefined);

  // Sync URL → state (deep-link, back/forward)
  useEffect(() => {
    if (urlSelectedId && urlSelectedId !== selectedId) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId]);

  // Si l'URL pointe une catégorie introuvable, on rabat sur la première
  useEffect(() => {
    if (selectedId && !categories.some((c) => c.id === selectedId)) {
      setSelectedId(categories[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("cat");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, categories, pathname, router, searchParams]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("cat", id);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  function handleBack() {
    setSelectedId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cat");
    startTransition(() => router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`));
  }

  async function handleDelete(cat: CategoryRow) {
    if (cat.productCount > 0) {
      toast.error("Impossible", "Cette catégorie est utilisée par des produits.");
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette catégorie ?",
      message: `La catégorie "${cat.name}" et toutes ses sous-catégories seront définitivement supprimées.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    await deleteCategory(cat.id);
    const remaining = categories.filter((c) => c.id !== cat.id);
    setSelectedId(remaining[0]?.id ?? null);
    router.refresh();
  }

  async function handleSaveCat(
    name: string,
    translations: Record<string, string>,
    _hex?: string,
    _patternImage?: string | null,
    pfs?: { pfsGender?: string | null; pfsFamilyName?: string | null; pfsCategoryName?: string | null },
    faire?: { taxonomyId?: string | null },
  ) {
    if (!editCat) return;
    await updateCategoryDirect(editCat.id, name, translations);
    const newGender = pfs?.pfsGender ?? null;
    const newFamily = pfs?.pfsFamilyName ?? null;
    const newCategory = pfs?.pfsCategoryName ?? null;
    if (newGender !== editCat.pfsGender || newFamily !== editCat.pfsFamilyName || newCategory !== editCat.pfsCategoryName) {
      await updateCategoryPfsTaxonomy(editCat.id, newGender, newFamily, newCategory);
    }
    const newFaireTaxonomy = faire?.taxonomyId ?? null;
    if (newFaireTaxonomy !== (editCat.faireTaxonomyId ?? null)) {
      await updateCategoryFaireTaxonomy(editCat.id, newFaireTaxonomy);
    }
    router.refresh();
  }

  async function handleSaveSub(name: string, translations: Record<string, string>) {
    if (!editSub) return;
    await updateSubCategoryDirect(editSub.sub.id, name, translations);
    router.refresh();
  }

  async function handleSubDelete(sub: Sub) {
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette sous-catégorie ?",
      message: `"${sub.name}" sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    await deleteSubCategory(sub.id);
    router.refresh();
  }

  const selectedCat = categories.find((c) => c.id === selectedId) ?? null;
  const selectedDetail: CategoryDetailData | null = selectedCat
    ? {
        id: selectedCat.id,
        name: selectedCat.name,
        translations: selectedCat.translations,
        productCount: selectedCat.productCount,
        createdAt: selectedCat.createdAt,
        subCategories: selectedCat.subCategories,
        pfsLabel: selectedCat.pfsLabel,
        efashionLabel: selectedCat.efashionLabel,
        faireLabel: selectedCat.faireLabel,
      }
    : null;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl shadow-[var(--shadow-pop)] overflow-hidden">
        {/* Sur mobile : on cache le panneau gauche quand une cat est sélectionnée */}
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border`}>
          <CategoriesList
            categories={categories}
            selectedId={selectedId}
            onSelect={handleSelect}
            hasPfsConfig={hasPfsConfig}
            hasEfashionConfig={hasEfashionConfig}
            hasFaireConfig={hasFaireConfig}
          />
        </div>
        {/* Sur mobile : on cache le panneau droit s'il n'y a pas de sélection */}
        <div className={`${selectedId ? "block" : "hidden"} md:block`}>
          {selectedDetail ? (
            <CategoryDetail
              category={selectedDetail}
              showBackButton={!!selectedId}
              onBack={handleBack}
              onEdit={() => { setEditFocusMarketplace(undefined); setEditCat(selectedCat); }}
              onDelete={() => selectedCat && handleDelete(selectedCat)}
              onSubAdd={() => setSubModalCatId(selectedCat!.id)}
              onSubEdit={(s) => setEditSub({ sub: s, catId: selectedCat!.id })}
              onSubDelete={handleSubDelete}
              onEditMapping={(mp) => { setEditFocusMarketplace(mp); setEditCat(selectedCat); }}
            />
          ) : (
            <div className="hidden md:flex flex-col items-center justify-center min-h-[580px] text-text-muted text-sm">
              Sélectionnez une catégorie à gauche.
            </div>
          )}
        </div>
      </div>

      {/* Modale création */}
      <QuickCreateModal
        type="category"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false);
          if (created?.id) handleSelect(created.id);
          router.refresh();
        }}
      />

      {/* Modale édition catégorie */}
      {editCat && (
        <QuickCreateModal
          type="category"
          open={!!editCat}
          onClose={() => setEditCat(null)}
          onCreated={() => { setEditCat(null); router.refresh(); }}
          focusMarketplace={editFocusMarketplace}
          editMode={{
            id: editCat.id,
            name: editCat.name,
            translations: editCat.translations,
            pfsGender: editCat.pfsGender,
            pfsFamilyName: editCat.pfsFamilyName,
            pfsCategoryName: editCat.pfsCategoryName,
            efashionCurrentId: editCat.efashionCategorieId,
            faireCurrentTaxonomyId: editCat.faireTaxonomyId,
            onSave: handleSaveCat,
          }}
        />
      )}

      {/* Modale création sous-catégorie */}
      {subModalCatId && (
        <QuickCreateModal
          type="subcategory"
          open={!!subModalCatId}
          onClose={() => setSubModalCatId(null)}
          onCreated={() => { setSubModalCatId(null); router.refresh(); }}
          categoryId={subModalCatId}
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

      {/* Bouton invisible déclencheur de création — appelé par le bouton "+ Nouvelle catégorie" du header de page */}
      <button
        type="button"
        data-trigger-create-category
        className="hidden"
        onClick={() => setCreateOpen(true)}
      />
    </>
  );
}

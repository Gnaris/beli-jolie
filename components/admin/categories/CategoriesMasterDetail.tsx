"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import CategoriesList from "./CategoriesList";
import CategoryDetail, { type CategoryDetailData } from "./CategoryDetail";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import CategoryEditorModal from "./CategoryEditorModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  deleteCategory,
  deleteSubCategory,
  reorderCategories,
  updateCategoryDirect,
  updateCategoryPfsTaxonomy,
  updateCategoryFaireTaxonomy,
  updateSubCategoryDirect,
} from "@/app/actions/admin/categories";

type Sub = { id: string; name: string; translations: Record<string, string> };

export type CategoryRow = {
  id: string;
  name: string;
  position: number;
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
  const [items, setItems] = useState<CategoryRow[]>(categories);
  useEffect(() => { setItems(categories); }, [categories]);
  const initialDesktopId = items[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(urlSelectedId ?? initialDesktopId);
  const [editCat, setEditCat] = useState<CategoryRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [subModalCatId, setSubModalCatId] = useState<string | null>(null);
  const [editSub, setEditSub] = useState<{ sub: Sub; catId: string } | null>(null);
  const [editFocusMarketplace, setEditFocusMarketplace] = useState<"pfs" | "efashion" | "faire" | undefined>(undefined);
  // ID d'une catégorie tout juste créée dont on veut la sélection différée :
  // items n'inclut la nouvelle cat qu'après router.refresh(), on sélectionne
  // au bon moment (voir useEffect ci-dessous). Sans ce délai, la sélection
  // arrivait avant les items → le useEffect de repli croyait la sélection
  // orpheline et lançait router.replace() en boucle.
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);

  function handleReorder(newOrderedIds: string[]) {
    const positionMap = new Map(newOrderedIds.map((id, i) => [id, i]));
    const previous = items;
    setItems((prev) =>
      [...prev]
        .map((c) => ({ ...c, position: positionMap.get(c.id) ?? c.position }))
        .sort((a, b) => a.position - b.position),
    );
    startTransition(async () => {
      try {
        await reorderCategories(newOrderedIds);
      } catch (err) {
        setItems(previous);
        toast.error("Erreur", (err as Error).message);
      }
    });
  }

  // Sync URL → state (deep-link, back/forward), uniquement si l'ID de l'URL
  // existe encore dans items. Sans ce garde, supprimer la catégorie affichée
  // ferait ping-pong avec l'effet de repli ci-dessous → boucle infinie.
  useEffect(() => {
    if (
      urlSelectedId &&
      urlSelectedId !== selectedId &&
      items.some((c) => c.id === urlSelectedId)
    ) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId, items]);

  // Si l'URL pointe une catégorie introuvable, on rabat sur la première.
  // On skippe le repli quand une création est en vol (pendingSelectId) :
  // l'ID de la nouvelle cat n'est légitimement pas encore dans items, il ne
  // faut pas croire à un orphelin. On utilise history.replaceState (comme
  // handleSelect) au lieu de router.replace pour éviter un re-render serveur.
  useEffect(() => {
    if (pendingSelectId) return;
    if (selectedId && !items.some((c) => c.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("cat");
      window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, items, pathname, searchParams, pendingSelectId]);

  // Sélection différée : quand la nouvelle catégorie apparaît enfin dans
  // items (après router.refresh()), on l'active + on synchronise l'URL.
  useEffect(() => {
    if (!pendingSelectId) return;
    if (!items.some((c) => c.id === pendingSelectId)) return;
    setSelectedId(pendingSelectId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("cat", pendingSelectId);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    setPendingSelectId(null);
  }, [pendingSelectId, items, pathname, searchParams]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("cat", id);
    // window.history.replaceState évite un re-render serveur (router.replace
    // ré-invoque la page Server Component, ce qui re-fetch Prisma + labels et
    // crée un lag perceptible à chaque clic).
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  function handleBack() {
    setSelectedId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cat");
    window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
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
    const remaining = items.filter((c) => c.id !== cat.id);
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

  const selectedCat = items.find((c) => c.id === selectedId) ?? null;
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
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl shadow-[var(--shadow-pop)] overflow-hidden md:h-[calc(100vh-14rem)] md:min-h-[520px]">
        {/* Sur mobile : on cache le panneau gauche quand une cat est sélectionnée */}
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border md:min-h-0 md:h-full md:overflow-hidden`}>
          <CategoriesList
            categories={items}
            selectedId={selectedId}
            onSelect={handleSelect}
            hasPfsConfig={hasPfsConfig}
            hasEfashionConfig={hasEfashionConfig}
            hasFaireConfig={hasFaireConfig}
            onReorder={handleReorder}
          />
        </div>
        {/* Sur mobile : on cache le panneau droit s'il n'y a pas de sélection */}
        <div className={`${selectedId ? "block" : "hidden"} md:block md:min-h-0 md:h-full md:overflow-hidden`}>
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
            <div className="hidden md:flex flex-col items-center justify-center h-full min-h-[520px] text-text-muted text-sm">
              Sélectionnez une catégorie à gauche.
            </div>
          )}
        </div>
      </div>

      {/* Modale création */}
      <CategoryEditorModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false);
          if (created?.id) setPendingSelectId(created.id);
          router.refresh();
        }}
      />

      {/* Modale édition catégorie */}
      {editCat && (
        <CategoryEditorModal
          open={!!editCat}
          onClose={() => setEditCat(null)}
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
            onSave: async (name, translations, pfs, faire) => {
              await handleSaveCat(name, translations, undefined, undefined, pfs, faire);
            },
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

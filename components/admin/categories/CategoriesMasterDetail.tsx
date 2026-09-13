"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import CategoriesList from "./CategoriesList";
import CategoryDetail, { type CategoryDetailData } from "./CategoryDetail";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import CategoryEditorModal from "./CategoryEditorModal";
import OrderchampMappingDrawer, {
  type OrderchampMappingTarget,
} from "./OrderchampMappingDrawer";
import CategorySeoDrawer from "./CategorySeoDrawer";
import PfsCategoryMappingModal from "@/components/admin/shared/mapping-modals/PfsCategoryMappingModal";
import EfashionMappingModal from "@/components/admin/shared/mapping-modals/EfashionMappingModal";
import FaireCategoryMappingModal from "@/components/admin/shared/mapping-modals/FaireCategoryMappingModal";
import MicrostoreMappingModal from "@/components/admin/shared/mapping-modals/MicrostoreMappingModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  deleteCategory,
  deleteSubCategory,
  reorderCategories,
  updateCategoryDirect,
  updateCategoryMicrostoreMapping,
  updateSubCategoryDirect,
  updateSubCategoryMicrostoreMapping,
} from "@/app/actions/admin/categories";
import type { OrderchampCategoryLeaf } from "@/lib/orderchamp-taxonomy-shared";

type Sub = {
  id: string;
  name: string;
  translations: Record<string, string>;
  orderchampCategoryPath?: string | null;
  orderchampLabel?: string | null;
  microstoreCategoryId?: number | null;
  /** Nom Microstore résolu (ex "Bracelet") ou marqueur orphelin. */
  microstoreLabel?: string | null;
};

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  position: number;
  translations: Record<string, string>;
  pfsCategoryId: string | null;
  pfsGender: string | null;
  pfsFamilyName: string | null;
  pfsCategoryName: string | null;
  efashionCategorieId: number | null;
  faireTaxonomyId: string | null;
  orderchampCategoryPath: string | null;
  microstoreCategoryId: number | null;
  productCount: number;
  createdAt: Date;
  subCategories: Sub[];
  pfsLabel: string | null;
  efashionLabel: string | null;
  faireLabel: string | null;
  orderchampLabel: string | null;
  /** Nom Microstore résolu (ex "Bracelet") ou marqueur orphelin. */
  microstoreLabel: string | null;
};

type Props = {
  categories: CategoryRow[];
  hasPfsConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
  hasOrderchampConfig: boolean;
  orderchampTaxonomy: OrderchampCategoryLeaf[];
};

export default function CategoriesMasterDetail({
  categories,
  hasPfsConfig,
  hasEfashionConfig,
  hasFaireConfig,
  hasOrderchampConfig,
  orderchampTaxonomy,
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
  const [orderchampTarget, setOrderchampTarget] = useState<{
    target: OrderchampMappingTarget;
    currentPath: string | null;
  } | null>(null);
  // Mini-modals de mapping marketplace (1 par marketplace). Chacun est ouvert
  // par la carte correspondante dans <MarketplaceMappingCards>.
  const [mappingModal, setMappingModal] = useState<
    "pfs" | "efashion" | "faire" | "microstore" | null
  >(null);
  // Sous-catégorie ciblée par la modale Microstore (badge « M » sur les chips).
  // null tant que l'utilisatrice n'a pas cliqué le badge.
  const [microstoreSubTarget, setMicrostoreSubTarget] = useState<Sub | null>(null);
  // Drawer d'édition SEO (page publique /categories/[slug]) — ouvert par la
  // carte "Page publique — SEO" du panneau détail.
  const [seoDrawerOpen, setSeoDrawerOpen] = useState(false);
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

  async function handleSaveCat(name: string, translations: Record<string, string>) {
    if (!editCat) return;
    await updateCategoryDirect(editCat.id, name, translations);
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
        slug: selectedCat.slug,
        name: selectedCat.name,
        image: selectedCat.image,
        translations: selectedCat.translations,
        productCount: selectedCat.productCount,
        createdAt: selectedCat.createdAt,
        subCategories: selectedCat.subCategories,
        pfsLabel: selectedCat.pfsLabel,
        efashionLabel: selectedCat.efashionLabel,
        faireLabel: selectedCat.faireLabel,
        orderchampLabel: selectedCat.orderchampLabel,
        microstoreLabel: selectedCat.microstoreLabel,
      }
    : null;

  function openOrderchampMappingForCategory(cat: CategoryRow) {
    if (!hasOrderchampConfig) {
      toast.error(
        "Orderchamp non configuré",
        "Ajoute d'abord le token Orderchamp dans Paramètres → Marketplaces.",
      );
      return;
    }
    setOrderchampTarget({
      target: { kind: "category", id: cat.id, name: cat.name },
      currentPath: cat.orderchampCategoryPath,
    });
  }

  function openOrderchampMappingForSub(sub: Sub, parentCat: CategoryRow) {
    if (!hasOrderchampConfig) {
      toast.error(
        "Orderchamp non configuré",
        "Ajoute d'abord le token Orderchamp dans Paramètres → Marketplaces.",
      );
      return;
    }
    setOrderchampTarget({
      target: {
        kind: "subcategory",
        id: sub.id,
        name: sub.name,
        parentCategoryName: parentCat.name,
      },
      currentPath: sub.orderchampCategoryPath ?? null,
    });
  }

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
              onEdit={() => setEditCat(selectedCat)}
              onDelete={() => selectedCat && handleDelete(selectedCat)}
              onSubAdd={() => setSubModalCatId(selectedCat!.id)}
              onSubEdit={(s) => setEditSub({ sub: s, catId: selectedCat!.id })}
              onSubDelete={handleSubDelete}
              onSubOrderchamp={(s) => selectedCat && openOrderchampMappingForSub(s, selectedCat)}
              onSubMicrostore={(s) => setMicrostoreSubTarget(s)}
              onEditMapping={(mp) => {
                if (!selectedCat) return;
                if (mp === "orderchamp") {
                  openOrderchampMappingForCategory(selectedCat);
                  return;
                }
                setMappingModal(mp);
              }}
              onImageChange={(nextImage) => {
                if (!selectedCat) return;
                // Reflet local instantané : évite un router.refresh() qui
                // ferait re-fetch toutes les catégories + labels marketplaces.
                setItems((prev) =>
                  prev.map((c) =>
                    c.id === selectedCat.id ? { ...c, image: nextImage } : c,
                  ),
                );
              }}
              onEditSeo={() => setSeoDrawerOpen(true)}
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
          if (!created?.id) return;
          // Ajout optimiste local — pas de router.refresh() qui déclenche
          // un aller-retour serveur visible. La nouvelle catégorie s'ajoute
          // instantanément en tête de liste et se sélectionne toute seule.
          setItems((prev) => {
            if (prev.some((c) => c.id === created.id)) return prev;
            const optimistic: CategoryRow = {
              id: created.id,
              slug: "",
              name: created.name,
              image: null,
              position: prev.length,
              translations: { fr: created.name },
              pfsCategoryId: null,
              pfsGender: null,
              pfsFamilyName: null,
              pfsCategoryName: null,
              efashionCategorieId: null,
              faireTaxonomyId: null,
              orderchampCategoryPath: null,
              microstoreCategoryId: null,
              microstoreLabel: null,
              productCount: 0,
              createdAt: new Date(),
              subCategories: (created.subCategories ?? []).map((s) => ({
                id: s.id,
                name: s.name,
                translations: { fr: s.name },
                microstoreCategoryId: null,
                microstoreLabel: null,
              })),
              pfsLabel: null,
              efashionLabel: null,
              faireLabel: null,
              orderchampLabel: null,
            };
            return [...prev, optimistic];
          });
          setPendingSelectId(created.id);
        }}
      />

      {/* Modale renommage catégorie */}
      {editCat && (
        <CategoryEditorModal
          open={!!editCat}
          onClose={() => setEditCat(null)}
          editMode={{
            id: editCat.id,
            name: editCat.name,
            translations: editCat.translations,
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
          onCreated={(sub) => {
            const parentId = subModalCatId;
            setSubModalCatId(null);
            if (!sub?.id || !parentId) return;
            // Ajout optimiste local de la sous-catégorie dans sa catégorie parente,
            // sans passer par le serveur : la chip apparaît instantanément.
            setItems((prev) =>
              prev.map((c) =>
                c.id === parentId
                  ? {
                      ...c,
                      subCategories: c.subCategories.some((s) => s.id === sub.id)
                        ? c.subCategories
                        : [
                            ...c.subCategories,
                            {
                              id: sub.id,
                              name: sub.name,
                              translations: { fr: sub.name },
                              microstoreCategoryId: null,
                              microstoreLabel: null,
                            },
                          ],
                    }
                  : c,
              ),
            );
          }}
          categoryId={subModalCatId}
        />
      )}

      {/* Modale édition sous-catégorie */}
      {editSub && (
        <QuickCreateModal
          type="subcategory"
          open={!!editSub}
          onClose={() => setEditSub(null)}
          onCreated={(sub) => {
            const { catId, sub: previous } = editSub;
            setEditSub(null);
            if (!sub?.id) return;
            // Renomme la sous-catégorie localement — pas besoin de refetch.
            setItems((prev) =>
              prev.map((c) =>
                c.id === catId
                  ? {
                      ...c,
                      subCategories: c.subCategories.map((s) =>
                        s.id === previous.id
                          ? { ...s, name: sub.name, translations: { ...s.translations, fr: sub.name } }
                          : s,
                      ),
                    }
                  : c,
              ),
            );
          }}
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

      {/* Mini-modals mapping marketplace (1 par carte) */}
      {selectedCat && (
        <>
          <PfsCategoryMappingModal
            open={mappingModal === "pfs"}
            onClose={() => setMappingModal(null)}
            categoryId={selectedCat.id}
            categoryName={selectedCat.name}
            currentGender={selectedCat.pfsGender}
            currentFamilyName={selectedCat.pfsFamilyName}
            currentCategoryName={selectedCat.pfsCategoryName}
          />
          <EfashionMappingModal
            open={mappingModal === "efashion"}
            onClose={() => setMappingModal(null)}
            entityId={selectedCat.id}
            entityName={selectedCat.name}
            entityLabel={`Catégorie « ${selectedCat.name} »`}
            kind="category"
            currentValue={selectedCat.efashionCategorieId}
          />
          <FaireCategoryMappingModal
            open={mappingModal === "faire"}
            onClose={() => setMappingModal(null)}
            categoryId={selectedCat.id}
            categoryName={selectedCat.name}
            currentTaxonomyId={selectedCat.faireTaxonomyId}
          />
          <MicrostoreMappingModal
            open={mappingModal === "microstore"}
            onClose={() => setMappingModal(null)}
            entityLabel={`Catégorie « ${selectedCat.name} »`}
            kind="category"
            currentValue={selectedCat.microstoreCategoryId}
            onSave={(next) => updateCategoryMicrostoreMapping(selectedCat.id, next)}
          />
        </>
      )}

      {/* Drawer mapping Orderchamp (feuille standard OC) — commun cat + sous-cat */}
      <OrderchampMappingDrawer
        open={!!orderchampTarget}
        onClose={() => setOrderchampTarget(null)}
        target={orderchampTarget?.target ?? null}
        currentPath={orderchampTarget?.currentPath ?? null}
        leaves={orderchampTaxonomy}
      />

      {/* Drawer SEO éditorial de la page publique catégorie */}
      {selectedCat && (
        <CategorySeoDrawer
          open={seoDrawerOpen}
          onClose={() => setSeoDrawerOpen(false)}
          categoryId={selectedCat.id}
          categoryName={selectedCat.name}
          categorySlug={selectedCat.slug}
        />
      )}

      {/* Modale mapping Microstore — sous-catégorie ciblée */}
      {microstoreSubTarget && (
        <MicrostoreMappingModal
          open={!!microstoreSubTarget}
          onClose={() => setMicrostoreSubTarget(null)}
          entityLabel={`Sous-catégorie « ${microstoreSubTarget.name} »`}
          kind="category"
          currentValue={microstoreSubTarget.microstoreCategoryId ?? null}
          onSave={(next) => updateSubCategoryMicrostoreMapping(microstoreSubTarget.id, next)}
        />
      )}
    </>
  );
}

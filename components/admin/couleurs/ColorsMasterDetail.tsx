"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import ColorsList from "./ColorsList";
import ColorDetail, { type ColorDetailData } from "./ColorDetail";
import ColorEditorModal from "./ColorEditorModal";
import ColorResyncModal from "./ColorResyncModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { deleteColor, updateColorDirect, reorderColors, type AffectedProduct } from "@/app/actions/admin/colors";

export type ColorRow = {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  translations: Record<string, string>;
  pfsColorRef: string | null;
  pfsSharedCount: number;
  efashionColorId: number | null;
  efashionLabel: string | null;
  productCount: number;
  position: number;
  createdAt: Date;
};

type Props = {
  colors: ColorRow[];
  hasPfsConfig: boolean;
  hasEfashionConfig: boolean;
  pfsEnabled: boolean;
  ankorstoreEnabled: boolean;
};

export default function ColorsMasterDetail({
  colors,
  hasPfsConfig,
  hasEfashionConfig,
  pfsEnabled,
  ankorstoreEnabled,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [, startTransition] = useTransition();

  // Copie locale pour permettre l'optimistic update lors du drag & drop.
  const [items, setItems] = useState<ColorRow[]>(colors);
  useEffect(() => { setItems(colors); }, [colors]);

  const urlSelectedId = searchParams.get("color");
  const initialDesktopId = items[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(urlSelectedId ?? initialDesktopId);
  const [editTarget, setEditTarget] = useState<ColorRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editResync, setEditResync] = useState<{
    products: AffectedProduct[];
    pfsChecked: boolean;
    ankorsChecked: boolean;
  } | null>(null);

  // Sync URL → state (deep-link, back/forward)
  useEffect(() => {
    if (urlSelectedId && urlSelectedId !== selectedId) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId]);

  // Rabat sur la première couleur si l'URL pointe une entrée introuvable
  useEffect(() => {
    if (selectedId && !items.some((c) => c.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("color");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, items, pathname, router, searchParams]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("color", id);
    // window.history.replaceState évite un re-render serveur (router.replace
    // ré-invoque la page Server Component, ce qui re-fetch Prisma + labels et
    // crée un lag perceptible à chaque clic).
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  function handleBack() {
    setSelectedId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("color");
    window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  async function handleDelete(color: ColorRow) {
    if (color.productCount > 0) {
      toast.error(
        "Impossible",
        `« ${color.name} » est utilisée par ${color.productCount} produit${color.productCount > 1 ? "s" : ""}.`,
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette couleur ?",
      message: `La couleur "${color.name}" sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    await deleteColor(color.id);
    const remaining = items.filter((c) => c.id !== color.id);
    setSelectedId(remaining[0]?.id ?? null);
    router.refresh();
  }

  function handleReorder(newOrderedIds: string[]) {
    // Optimistic — recalcul immédiat des positions.
    const positionMap = new Map(newOrderedIds.map((id, i) => [id, i]));
    const previous = items;
    setItems((prev) =>
      prev.map((c) => ({ ...c, position: positionMap.get(c.id) ?? c.position })),
    );
    startTransition(async () => {
      try {
        await reorderColors(newOrderedIds);
      } catch (err) {
        setItems(previous);
        toast.error("Erreur", (err as Error).message);
      }
    });
  }

  async function handleSaveColor(
    name: string,
    translations: Record<string, string>,
    hex: string | null,
    patternImage: string | null,
    pfsRef: string | null,
  ) {
    if (!editTarget) return;
    const res = await updateColorDirect(
      editTarget.id,
      name,
      hex,
      translations,
      patternImage,
      pfsRef,
    );
    router.refresh();

    // Nom changé → Ankorstore concerné. Ref PFS changée → PFS concerné.
    const proposeAnkorstore = res.nameChanged && ankorstoreEnabled;
    const proposePfs = res.pfsColorRefChanged && pfsEnabled;
    if ((proposeAnkorstore || proposePfs) && res.affectedProducts.length > 0) {
      setEditResync({
        products: res.affectedProducts,
        pfsChecked: proposePfs,
        ankorsChecked: proposeAnkorstore,
      });
    }
  }

  const selectedColor = items.find((c) => c.id === selectedId) ?? null;
  const selectedDetail: ColorDetailData | null = selectedColor
    ? {
        id: selectedColor.id,
        name: selectedColor.name,
        hex: selectedColor.hex,
        patternImage: selectedColor.patternImage,
        translations: selectedColor.translations,
        productCount: selectedColor.productCount,
        createdAt: selectedColor.createdAt,
        pfsLabel: selectedColor.pfsColorRef,
        pfsSharedCount: selectedColor.pfsSharedCount,
        efashionLabel:
          selectedColor.efashionLabel ??
          (selectedColor.efashionColorId != null ? `id ${selectedColor.efashionColorId}` : null),
      }
    : null;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl shadow-[var(--shadow-pop)] overflow-hidden md:h-[calc(100vh-14rem)] md:min-h-[520px]">
        {/* Sur mobile : masquer la liste quand une couleur est sélectionnée */}
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border md:min-h-0 md:h-full md:overflow-hidden`}>
          <ColorsList
            colors={items}
            selectedId={selectedId}
            onSelect={handleSelect}
            hasPfsConfig={hasPfsConfig}
            hasEfashionConfig={hasEfashionConfig}
            onReorder={handleReorder}
          />
        </div>
        {/* Sur mobile : masquer le détail s'il n'y a pas de sélection */}
        <div className={`${selectedId ? "block" : "hidden"} md:block md:min-h-0 md:h-full md:overflow-hidden`}>
          {selectedDetail ? (
            <ColorDetail
              color={selectedDetail}
              showBackButton={!!selectedId}
              onBack={handleBack}
              onEdit={() => selectedColor && setEditTarget(selectedColor)}
              onDelete={() => selectedColor && handleDelete(selectedColor)}
              onEditMapping={() => selectedColor && setEditTarget(selectedColor)}
            />
          ) : (
            <div className="hidden md:flex flex-col items-center justify-center h-full min-h-[520px] text-text-muted text-sm">
              Sélectionnez une couleur à gauche.
            </div>
          )}
        </div>
      </div>

      {/* Modale création */}
      <ColorEditorModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false);
          if (created?.id) handleSelect(created.id);
          router.refresh();
        }}
      />

      {/* Modale édition */}
      {editTarget && (
        <ColorEditorModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          editMode={{
            id: editTarget.id,
            name: editTarget.name,
            translations: editTarget.translations,
            hex: editTarget.hex,
            patternImage: editTarget.patternImage,
            pfsColorRef: editTarget.pfsColorRef,
            efashionCurrentId: editTarget.efashionColorId ?? null,
            onSave: handleSaveColor,
          }}
        />
      )}

      {/* Modale re-sync marketplaces */}
      {editResync && (
        <ColorResyncModal
          open={!!editResync}
          onClose={() => setEditResync(null)}
          products={editResync.products}
          title="Couleur modifiée"
          subtitle={`${editResync.products.length} produit${editResync.products.length > 1 ? "s" : ""} utilise${editResync.products.length > 1 ? "nt" : ""} cette couleur. Re-pousser sur les marketplaces ?`}
          pfsAvailable={pfsEnabled}
          ankorstoreAvailable={ankorstoreEnabled}
          pfsDefaultChecked={editResync.pfsChecked}
          ankorstoreDefaultChecked={editResync.ankorsChecked}
        />
      )}

      {/* Trigger invisible pour le bouton « Nouvelle couleur » du header de page */}
      <button
        type="button"
        data-trigger-create-color
        className="hidden"
        onClick={() => setCreateOpen(true)}
      />
    </>
  );
}

"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import CompositionsList from "./CompositionsList";
import CompositionDetail, { type CompositionDetailData } from "./CompositionDetail";
import CompositionEditorModal from "./CompositionEditorModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { deleteComposition, updateCompositionDirect, updateCompositionPfsRef, reorderCompositions } from "@/app/actions/admin/compositions";

export type CompositionRow = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsCompositionRef: string | null;
  efashionId: number | null;
  efashionLabel: string | null;
  productCount: number;
  position: number;
  createdAt: Date;
};

type Props = {
  compositions: CompositionRow[];
  hasPfsConfig: boolean;
  hasEfashionConfig: boolean;
};

export default function CompositionsMasterDetail({
  compositions,
  hasPfsConfig,
  hasEfashionConfig,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [, startTransition] = useTransition();

  // Copie locale pour permettre l'optimistic update lors du drag & drop.
  const [items, setItems] = useState<CompositionRow[]>(compositions);
  useEffect(() => { setItems(compositions); }, [compositions]);

  const urlSelectedId = searchParams.get("composition");
  const initialDesktopId = items[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(urlSelectedId ?? initialDesktopId);
  const [editTarget, setEditTarget] = useState<CompositionRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Sync URL → state (deep-link, back/forward)
  useEffect(() => {
    if (urlSelectedId && urlSelectedId !== selectedId) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId]);

  // Rabat sur la première composition si l'URL pointe une entrée introuvable
  useEffect(() => {
    if (selectedId && !items.some((c) => c.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("composition");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, items, pathname, router, searchParams]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("composition", id);
    // window.history.replaceState : évite un re-render Server Component à chaque
    // clic (cf. ColorsMasterDetail).
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  function handleBack() {
    setSelectedId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("composition");
    window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  async function handleDelete(comp: CompositionRow) {
    if (comp.productCount > 0) {
      toast.error(
        "Impossible",
        `« ${comp.name} » est utilisée par ${comp.productCount} produit${comp.productCount > 1 ? "s" : ""}.`,
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette composition ?",
      message: `La composition "${comp.name}" sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    try {
      await deleteComposition(comp.id);
      const remaining = items.filter((c) => c.id !== comp.id);
      setSelectedId(remaining[0]?.id ?? null);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de la suppression.";
      toast.error("Suppression", message);
    }
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
        await reorderCompositions(newOrderedIds);
      } catch (err) {
        setItems(previous);
        toast.error("Erreur", (err as Error).message);
      }
    });
  }

  async function handleSaveComposition(
    name: string,
    translations: Record<string, string>,
    _hex?: string,
    _patternImage?: string | null,
    extra?: { ref?: string },
  ) {
    if (!editTarget) return;
    await updateCompositionDirect(editTarget.id, name, translations);
    const newRef = extra?.ref || null;
    if (newRef !== (editTarget.pfsCompositionRef ?? null)) {
      await updateCompositionPfsRef(editTarget.id, newRef);
    }
    router.refresh();
  }

  const selectedComp = items.find((c) => c.id === selectedId) ?? null;
  const selectedDetail: CompositionDetailData | null = selectedComp
    ? {
        id: selectedComp.id,
        name: selectedComp.name,
        translations: selectedComp.translations,
        productCount: selectedComp.productCount,
        createdAt: selectedComp.createdAt,
        pfsLabel: selectedComp.pfsCompositionRef,
        efashionLabel:
          selectedComp.efashionLabel ??
          (selectedComp.efashionId != null ? `id ${selectedComp.efashionId}` : null),
      }
    : null;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl shadow-[var(--shadow-pop)] overflow-hidden md:h-[calc(100vh-14rem)] md:min-h-[520px]">
        {/* Sur mobile : masquer la liste quand une composition est sélectionnée */}
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border md:min-h-0 md:h-full md:overflow-hidden`}>
          <CompositionsList
            compositions={items}
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
            <CompositionDetail
              composition={selectedDetail}
              showBackButton={!!selectedId}
              onBack={handleBack}
              onEdit={() => selectedComp && setEditTarget(selectedComp)}
              onDelete={() => selectedComp && handleDelete(selectedComp)}
              onEditMapping={() => selectedComp && setEditTarget(selectedComp)}
            />
          ) : (
            <div className="hidden md:flex flex-col items-center justify-center h-full min-h-[520px] text-text-muted text-sm">
              Sélectionnez une composition à gauche.
            </div>
          )}
        </div>
      </div>

      {/* Modale création */}
      <CompositionEditorModal
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
        <CompositionEditorModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          editMode={{
            id: editTarget.id,
            name: editTarget.name,
            translations: editTarget.translations,
            pfsRef: editTarget.pfsCompositionRef,
            efashionCurrentId: editTarget.efashionId ?? null,
            onSave: handleSaveComposition,
          }}
        />
      )}

      {/* Trigger invisible pour le bouton « Nouvelle composition » du header de page */}
      <button
        type="button"
        data-trigger-create-composition
        className="hidden"
        onClick={() => setCreateOpen(true)}
      />
    </>
  );
}

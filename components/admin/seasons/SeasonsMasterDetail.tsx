"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import SeasonsList from "./SeasonsList";
import SeasonDetail, { type SeasonDetailData } from "./SeasonDetail";
import SeasonEditorModal from "./SeasonEditorModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { deleteSeason, updateSeasonDirect, updateSeasonPfsRef, reorderSeasons } from "@/app/actions/admin/seasons";

export type SeasonRow = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsRef: string | null;
  efashionCollectionId: number | null;
  efashionLabel: string | null;
  productCount: number;
  position: number;
  createdAt: Date;
};

type Props = {
  seasons: SeasonRow[];
  hasPfsConfig: boolean;
  hasEfashionConfig: boolean;
};

export default function SeasonsMasterDetail({
  seasons,
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
  const [items, setItems] = useState<SeasonRow[]>(seasons);
  useEffect(() => { setItems(seasons); }, [seasons]);

  const urlSelectedId = searchParams.get("season");
  const initialDesktopId = items[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(urlSelectedId ?? initialDesktopId);
  const [editTarget, setEditTarget] = useState<SeasonRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (urlSelectedId && urlSelectedId !== selectedId) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId]);

  useEffect(() => {
    if (selectedId && !items.some((s) => s.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("season");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, items, pathname, router, searchParams]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("season", id);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  function handleBack() {
    setSelectedId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("season");
    window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  async function handleDelete(season: SeasonRow) {
    if (season.productCount > 0) {
      toast.error(
        "Impossible",
        `« ${season.name} » est utilisée par ${season.productCount} produit${season.productCount > 1 ? "s" : ""}.`,
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette saison ?",
      message: `La saison "${season.name}" sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    try {
      await deleteSeason(season.id);
      const remaining = items.filter((s) => s.id !== season.id);
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
      prev.map((s) => ({ ...s, position: positionMap.get(s.id) ?? s.position })),
    );
    startTransition(async () => {
      try {
        await reorderSeasons(newOrderedIds);
      } catch (err) {
        setItems(previous);
        toast.error("Erreur", (err as Error).message);
      }
    });
  }

  async function handleSaveSeason(
    name: string,
    translations: Record<string, string>,
    _hex?: string,
    _patternImage?: string | null,
    extra?: { ref?: string },
  ) {
    if (!editTarget) return;
    await updateSeasonDirect(editTarget.id, name, translations);
    const newRef = extra?.ref || null;
    if (newRef !== (editTarget.pfsRef ?? null)) {
      await updateSeasonPfsRef(editTarget.id, newRef);
    }
    router.refresh();
  }

  const selectedSeason = items.find((s) => s.id === selectedId) ?? null;
  const selectedDetail: SeasonDetailData | null = selectedSeason
    ? {
        id: selectedSeason.id,
        name: selectedSeason.name,
        translations: selectedSeason.translations,
        productCount: selectedSeason.productCount,
        createdAt: selectedSeason.createdAt,
        pfsLabel: selectedSeason.pfsRef,
        efashionLabel:
          selectedSeason.efashionLabel ??
          (selectedSeason.efashionCollectionId != null ? `id ${selectedSeason.efashionCollectionId}` : null),
      }
    : null;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl shadow-[var(--shadow-pop)] overflow-hidden md:h-[calc(100vh-14rem)] md:min-h-[520px]">
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border md:min-h-0 md:h-full md:overflow-hidden`}>
          <SeasonsList
            seasons={items}
            selectedId={selectedId}
            onSelect={handleSelect}
            hasPfsConfig={hasPfsConfig}
            hasEfashionConfig={hasEfashionConfig}
            onReorder={handleReorder}
          />
        </div>
        <div className={`${selectedId ? "block" : "hidden"} md:block md:min-h-0 md:h-full md:overflow-hidden`}>
          {selectedDetail ? (
            <SeasonDetail
              season={selectedDetail}
              showBackButton={!!selectedId}
              onBack={handleBack}
              onEdit={() => selectedSeason && setEditTarget(selectedSeason)}
              onDelete={() => selectedSeason && handleDelete(selectedSeason)}
              onEditMapping={() => selectedSeason && setEditTarget(selectedSeason)}
            />
          ) : (
            <div className="hidden md:flex flex-col items-center justify-center h-full min-h-[520px] text-text-muted text-sm">
              Sélectionnez une saison à gauche.
            </div>
          )}
        </div>
      </div>

      <SeasonEditorModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false);
          if (created?.id) handleSelect(created.id);
          router.refresh();
        }}
      />

      {editTarget && (
        <SeasonEditorModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          editMode={{
            id: editTarget.id,
            name: editTarget.name,
            translations: editTarget.translations,
            pfsRef: editTarget.pfsRef,
            efashionCurrentId: editTarget.efashionCollectionId ?? null,
            onSave: handleSaveSeason,
          }}
        />
      )}

      <button
        type="button"
        data-trigger-create-season
        className="hidden"
        onClick={() => setCreateOpen(true)}
      />
    </>
  );
}

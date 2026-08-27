"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import SeasonsList from "./SeasonsList";
import SeasonDetail, { type SeasonDetailData } from "./SeasonDetail";
import SeasonEditorModal from "./SeasonEditorModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  deleteSeason,
  updateSeasonDirect,
  updateSeasonPfsRef,
  updateSeasonMicrostoreMapping,
  reorderSeasons,
} from "@/app/actions/admin/seasons";
import PfsRefMappingModal from "@/components/admin/shared/mapping-modals/PfsRefMappingModal";
import EfashionMappingModal from "@/components/admin/shared/mapping-modals/EfashionMappingModal";
import MicrostoreMappingModal from "@/components/admin/shared/mapping-modals/MicrostoreMappingModal";

export type SeasonRow = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsRef: string | null;
  efashionCollectionId: number | null;
  efashionLabel: string | null;
  microstoreSeasonId: number | null;
  /** Nom Microstore résolu (ex "Été 2026") ou marqueur orphelin. */
  microstoreLabel: string | null;
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
  const [mappingModal, setMappingModal] = useState<"pfs" | "efashion" | "microstore" | null>(null);

  // Sync URL → state, mais UNIQUEMENT si l'ID de l'URL existe encore dans items.
  // Sans ce garde, la suppression de la saison affichée fait ping-pong entre
  // cet effet (qui repose selectedId sur l'URL obsolète) et l'effet de repli
  // ci-dessous (qui repose selectedId sur items[0] + nettoie l'URL).
  useEffect(() => {
    if (
      urlSelectedId &&
      urlSelectedId !== selectedId &&
      items.some((s) => s.id === urlSelectedId)
    ) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId, items]);

  useEffect(() => {
    if (selectedId && !items.some((s) => s.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("season");
      window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, items, pathname, searchParams]);

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

  async function handleSaveSeason(name: string, translations: Record<string, string>) {
    if (!editTarget) return;
    await updateSeasonDirect(editTarget.id, name, translations);
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
        microstoreLabel: selectedSeason.microstoreLabel,
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
              onEditMapping={(mp) => selectedSeason && setMappingModal(mp)}
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
          if (!created?.id) return;
          // Ajout optimiste local — pas de router.refresh() qui déclenche
          // un aller-retour serveur visible. La nouvelle saison apparaît
          // immédiatement et se sélectionne toute seule.
          setItems((prev) => {
            if (prev.some((s) => s.id === created.id)) return prev;
            const optimistic: SeasonRow = {
              id: created.id,
              name: created.name,
              translations: { fr: created.name },
              pfsRef: null,
              efashionCollectionId: null,
              efashionLabel: null,
              microstoreSeasonId: null,
              microstoreLabel: null,
              productCount: 0,
              position: prev.length,
              createdAt: new Date(),
            };
            return [...prev, optimistic];
          });
          handleSelect(created.id);
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
            onSave: handleSaveSeason,
          }}
        />
      )}

      {/* Mini-modals mapping marketplace (1 par carte) */}
      {selectedSeason && (
        <>
          <PfsRefMappingModal
            open={mappingModal === "pfs"}
            onClose={() => setMappingModal(null)}
            entityType="season"
            entityName={selectedSeason.name}
            entityLabel={`Saison « ${selectedSeason.name} »`}
            currentRef={selectedSeason.pfsRef}
            onSave={(next) => updateSeasonPfsRef(selectedSeason.id, next)}
          />
          <EfashionMappingModal
            open={mappingModal === "efashion"}
            onClose={() => setMappingModal(null)}
            entityId={selectedSeason.id}
            entityName={selectedSeason.name}
            entityLabel={`Saison « ${selectedSeason.name} »`}
            kind="season"
            currentValue={selectedSeason.efashionCollectionId}
          />
          <MicrostoreMappingModal
            open={mappingModal === "microstore"}
            onClose={() => setMappingModal(null)}
            entityLabel={`Saison « ${selectedSeason.name} »`}
            kind="season"
            currentValue={selectedSeason.microstoreSeasonId}
            onSave={(next) => updateSeasonMicrostoreMapping(selectedSeason.id, next)}
          />
        </>
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

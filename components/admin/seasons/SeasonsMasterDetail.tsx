"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import SeasonsList from "./SeasonsList";
import SeasonDetail, { type SeasonDetailData } from "./SeasonDetail";
import SeasonEditorModal from "./SeasonEditorModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { deleteSeason, updateSeasonDirect, updateSeasonPfsRef } from "@/app/actions/admin/seasons";

export type SeasonRow = {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsRef: string | null;
  efashionCollectionId: number | null;
  efashionLabel: string | null;
  productCount: number;
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

  const urlSelectedId = searchParams.get("season");
  const initialDesktopId = seasons[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(urlSelectedId ?? initialDesktopId);
  const [editTarget, setEditTarget] = useState<SeasonRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (urlSelectedId && urlSelectedId !== selectedId) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId]);

  useEffect(() => {
    if (selectedId && !seasons.some((s) => s.id === selectedId)) {
      setSelectedId(seasons[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("season");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, seasons, pathname, router, searchParams]);

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
      const remaining = seasons.filter((s) => s.id !== season.id);
      setSelectedId(remaining[0]?.id ?? null);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de la suppression.";
      toast.error("Suppression", message);
    }
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

  const selectedSeason = seasons.find((s) => s.id === selectedId) ?? null;
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
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl shadow-[var(--shadow-pop)] overflow-hidden">
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border`}>
          <SeasonsList
            seasons={seasons}
            selectedId={selectedId}
            onSelect={handleSelect}
            hasPfsConfig={hasPfsConfig}
            hasEfashionConfig={hasEfashionConfig}
          />
        </div>
        <div className={`${selectedId ? "block" : "hidden"} md:block`}>
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
            <div className="hidden md:flex flex-col items-center justify-center min-h-[580px] text-text-muted text-sm">
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

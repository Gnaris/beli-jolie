"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import SizesList from "./SizesList";
import SizeDetail from "./SizeDetail";
import SizeEditorModal from "./SizeEditorModal";
import SizeMappingModal from "./SizeMappingModal";
import {
  createSize,
  updateSize,
  deleteSize,
  reorderSizes,
  setSizePfsMapping,
} from "@/app/actions/admin/sizes";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { PROTECTED_SIZE_VIRTUAL_ID, isProtectedSizeName } from "@/lib/protected-sizes";

export type SizeItem = {
  id: string;
  name: string;
  position: number;
  variantCount: number;
  pfsSizeRef: string | null;
};

export type PfsSizeOption = {
  reference: string;
  label: string;
};

type Props = {
  initialSizes: SizeItem[];
  pfsSizes: PfsSizeOption[];
};

export default function SizesMasterDetail({ initialSizes, pfsSizes }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [, startTransition] = useTransition();
  const pfsEnabled = pfsSizes.length > 0;

  const [sizes, setSizes] = useState<SizeItem[]>(initialSizes);
  useEffect(() => { setSizes(initialSizes); }, [initialSizes]);

  const urlSelectedId = searchParams.get("size");
  const firstNonProtected = initialSizes.find((s) => !isProtectedSizeName(s.name));
  const initialSelectedId = urlSelectedId ?? firstNonProtected?.id ?? initialSizes[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SizeItem | null>(null);
  const [mappingModal, setMappingModal] = useState<SizeItem | null>(null);

  // Sync URL → state (deep-link, back/forward)
  useEffect(() => {
    if (urlSelectedId && urlSelectedId !== selectedId) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId]);

  // Rabat sur la première taille si l'URL pointe une entrée introuvable
  useEffect(() => {
    if (selectedId && !sizes.some((s) => s.id === selectedId)) {
      setSelectedId(sizes[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("size");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, sizes, pathname, router, searchParams]);

  // Ordre trié (orphelins PFS en tête, puis position croissante) — utilisé
  // par la Detail pane pour connaître le rang courant et les bornes des flèches.
  const sortedIds = useMemo(() => {
    const out = [...sizes];
    if (pfsEnabled) {
      out.sort((a, b) => {
        const ao = a.pfsSizeRef == null ? 0 : 1;
        const bo = b.pfsSizeRef == null ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return a.position - b.position;
      });
    } else {
      out.sort((a, b) => a.position - b.position);
    }
    return out.map((s) => s.id);
  }, [sizes, pfsEnabled]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("size", id);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  function handleBack() {
    setSelectedId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("size");
    window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  async function handleCreate(name: string, pfsRef: string) {
    showLoading();
    try {
      const created = await createSize(name, pfsRef);
      toast.success(`Taille « ${created.name} » créée.`);
      router.refresh();
      handleSelect(created.id);
    } finally {
      hideLoading();
    }
  }

  async function handleRename(name: string) {
    if (!renameTarget) return;
    showLoading();
    try {
      await updateSize(renameTarget.id, name);
      toast.success("Taille renommée.");
      router.refresh();
    } finally {
      hideLoading();
    }
  }

  async function handleDelete(size: SizeItem) {
    if (size.variantCount > 0) {
      toast.error(
        "Impossible",
        `« ${size.name} » est utilisée par ${size.variantCount} variante${size.variantCount > 1 ? "s" : ""}.`,
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette taille ?",
      message: `« ${size.name} » sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    showLoading();
    startTransition(async () => {
      try {
        await deleteSize(size.id);
        toast.success("Taille supprimée.");
        const remaining = sizes.filter((s) => s.id !== size.id);
        setSelectedId(remaining[0]?.id ?? null);
        router.refresh();
      } catch (err) {
        toast.error("Erreur", (err as Error).message);
      } finally {
        hideLoading();
      }
    });
  }

  async function handleSetPfsRef(sizeId: string, ref: string) {
    const normalized = ref.length > 0 ? ref : null;
    // optimistic update
    setSizes((prev) => prev.map((s) => (s.id === sizeId ? { ...s, pfsSizeRef: normalized } : s)));
    try {
      const result = await setSizePfsMapping(sizeId, normalized);
      setSizes((prev) => prev.map((s) => (s.id === sizeId ? { ...s, pfsSizeRef: result.pfsSizeRef } : s)));
    } catch (err) {
      toast.error("Erreur PFS", (err as Error).message);
      router.refresh();
    }
  }

  function handleReorder(newRealOrderedIds: string[]) {
    // Optimistic update — recalcul immédiat des positions.
    const positionMap = new Map(newRealOrderedIds.map((id, i) => [id, i]));
    const previous = sizes;
    setSizes((prev) =>
      prev.map((s) => ({ ...s, position: positionMap.get(s.id) ?? s.position })),
    );
    startTransition(async () => {
      try {
        await reorderSizes(newRealOrderedIds);
      } catch (err) {
        setSizes(previous);
        toast.error("Erreur", (err as Error).message);
      }
    });
  }

  const selectedSize = sizes.find((s) => s.id === selectedId) ?? null;
  const positionInSorted = selectedSize ? sortedIds.indexOf(selectedSize.id) : -1;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl overflow-hidden md:h-[calc(100vh-22rem)] md:min-h-[600px]" style={{ boxShadow: "var(--shadow-pop)" }}>
        {/* Master (list) */}
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border md:min-h-0 md:h-full md:overflow-hidden`}>
          <SizesList
            sizes={sizes}
            selectedId={selectedId}
            onSelect={handleSelect}
            pfsEnabled={pfsEnabled}
            onReorder={handleReorder}
          />
        </div>

        {/* Detail pane */}
        <div className={`${selectedId ? "block" : "hidden"} md:block md:min-h-0 md:h-full md:overflow-hidden`}>
          {selectedSize ? (
            <SizeDetail
              size={{
                id: selectedSize.id,
                name: selectedSize.name,
                position: selectedSize.position,
                positionInSorted: positionInSorted >= 0 ? positionInSorted : 0,
                totalSortedCount: sortedIds.length,
                variantCount: selectedSize.variantCount,
                pfsSizeRef: selectedSize.pfsSizeRef,
              }}
              pfsEnabled={pfsEnabled}
              showBackButton={!!selectedId}
              onBack={handleBack}
              onRename={() => setRenameTarget(selectedSize)}
              onDelete={() => handleDelete(selectedSize)}
              onEditPfsMapping={() => setMappingModal(selectedSize)}
            />
          ) : (
            <div className="hidden md:flex flex-col items-center justify-center h-full min-h-[600px] text-text-muted text-sm">
              Sélectionnez une taille à gauche.
            </div>
          )}
        </div>
      </div>

      {/* Modale création */}
      {createOpen && (
        <SizeEditorModal
          mode="create"
          pfsOptions={pfsSizes}
          pfsEnabled={pfsEnabled}
          onCreate={handleCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {/* Modale renommage */}
      {renameTarget && (
        <SizeEditorModal
          mode="rename"
          currentName={renameTarget.name}
          onRename={handleRename}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {/* Modale mapping PFS */}
      {mappingModal && (
        <SizeMappingModal
          sizeId={mappingModal.id}
          sizeName={mappingModal.name}
          pfsRef={mappingModal.pfsSizeRef}
          pfsOptions={pfsSizes}
          pfsEnabled={pfsEnabled}
          onSavePfsRef={async (sizeId, ref) => {
            await handleSetPfsRef(sizeId, ref);
          }}
          onClose={() => {
            setMappingModal(null);
            router.refresh();
          }}
        />
      )}

      {/* Trigger invisible pour le bouton « Nouvelle taille » du header de page */}
      <button
        type="button"
        data-trigger-create-size
        className="hidden"
        onClick={() => setCreateOpen(true)}
      />
    </>
  );
}

"use client";

import { useState, useTransition, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
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
import CustomSelect from "@/components/ui/CustomSelect";
import { isProtectedSizeName } from "@/lib/protected-sizes";

interface SizeItem {
  id: string;
  name: string;
  position: number;
  variantCount: number;
  pfsSizeRef: string | null;
}

interface PfsSizeOption {
  reference: string;
  label: string;
}

export default function SizesManager({
  initialSizes,
  pfsSizes = [],
}: {
  initialSizes: SizeItem[];
  pfsSizes?: PfsSizeOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const pfsEnabled = pfsSizes.length > 0;

  // Create form
  const [newName, setNewName] = useState("");
  const [newPfsRef, setNewPfsRef] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit state (per-row inline)
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Sizes state (reorder + optimistic PFS ref)
  const [sizes, setSizes] = useState(initialSizes);
  useEffect(() => { setSizes(initialSizes); }, [initialSizes]);

  const [pfsSaving, setPfsSaving] = useState<string | null>(null);

  // Filter: show all vs only orphans
  const [filterOrphansOnly, setFilterOrphansOnly] = useState(false);

  // Sort: orphans first, then by position
  const sortedSizes = useMemo(() => {
    const out = [...sizes];
    if (pfsEnabled) {
      out.sort((a, b) => {
        const aOrphan = a.pfsSizeRef == null ? 0 : 1;
        const bOrphan = b.pfsSizeRef == null ? 0 : 1;
        if (aOrphan !== bOrphan) return aOrphan - bOrphan;
        return a.position - b.position;
      });
    }
    return filterOrphansOnly ? out.filter((s) => s.pfsSizeRef == null) : out;
  }, [sizes, filterOrphansOnly, pfsEnabled]);

  const orphanCount = useMemo(
    () => (pfsEnabled ? sizes.filter((s) => s.pfsSizeRef == null).length : 0),
    [sizes, pfsEnabled]
  );

  // ─────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────
  function handleCreate() {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setCreateError("Le nom est requis.");
      return;
    }
    if (!newPfsRef) {
      setCreateError("La référence Paris Fashion Shop est obligatoire.");
      return;
    }
    setCreateError(null);

    showLoading();
    startTransition(async () => {
      try {
        const created = await createSize(trimmedName, newPfsRef);
        setNewName("");
        setNewPfsRef("");
        toast.success(`Taille « ${created.name} » créée.`);
        router.refresh();
      } catch (err: unknown) {
        const message = (err as Error).message;
        setCreateError(message);
        toast.error(message);
      } finally {
        hideLoading();
      }
    });
  }

  function startEdit(size: SizeItem) {
    setEditId(size.id);
    setEditName(size.name);
  }

  function cancelEdit() {
    setEditId(null);
  }

  function handleUpdate() {
    if (!editId || !editName.trim()) return;
    showLoading();
    startTransition(async () => {
      try {
        await updateSize(editId, editName);
        setEditId(null);
        toast.success("Taille mise à jour.");
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
      } finally {
        hideLoading();
      }
    });
  }

  async function handleDelete(size: SizeItem) {
    const confirmed = await confirm({
      type: "danger",
      title: "Supprimer la taille",
      message: `Voulez-vous supprimer la taille « ${size.name} » ?`,
      confirmLabel: "Supprimer",
    });
    if (!confirmed) return;
    showLoading();
    startTransition(async () => {
      try {
        await deleteSize(size.id);
        toast.success("Taille supprimée.");
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
      } finally {
        hideLoading();
      }
    });
  }

  // ─────────────────────────────────────────────
  // PFS mapping — set or clear the single ref
  // ─────────────────────────────────────────────
  async function handleSetPfsRef(sizeId: string, ref: string) {
    const normalized = ref.length > 0 ? ref : null;
    // optimistic
    setSizes((prev) => prev.map((s) => (s.id === sizeId ? { ...s, pfsSizeRef: normalized } : s)));
    setPfsSaving(sizeId);
    try {
      const result = await setSizePfsMapping(sizeId, normalized);
      setSizes((prev) => prev.map((s) => (s.id === sizeId ? { ...s, pfsSizeRef: result.pfsSizeRef } : s)));
    } catch (err: unknown) {
      toast.error((err as Error).message);
      // revert by refreshing from server
      router.refresh();
    } finally {
      setPfsSaving(null);
    }
  }

  // ─────────────────────────────────────────────
  // Reorder
  // ─────────────────────────────────────────────
  const moveSize = useCallback(
    (index: number, direction: -1 | 1) => {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= sortedSizes.length) return;
      const newSortedIds = [...sortedSizes.map((s) => s.id)];
      [newSortedIds[index], newSortedIds[newIndex]] = [newSortedIds[newIndex], newSortedIds[index]];

      const positionMap = new Map(newSortedIds.map((id, i) => [id, i]));
      const newSizes = sizes.map((s) => ({
        ...s,
        position: positionMap.get(s.id) ?? s.position,
      }));
      setSizes(newSizes);
      startTransition(async () => {
        try {
          await reorderSizes(newSortedIds);
        } catch {
          setSizes(initialSizes);
        }
      });
    },
    [sortedSizes, sizes, initialSizes, startTransition]
  );

  const pfsOptions = useMemo(
    () => [{ value: "", label: "— Aucun —" }, ...pfsSizes.map((p) => ({ value: p.reference, label: p.label }))],
    [pfsSizes]
  );
  const pfsOptionsForCreate = useMemo(
    () => pfsSizes.map((p) => ({ value: p.reference, label: p.label })),
    [pfsSizes]
  );

  return (
    <>
      {/* ═══ CREATE FORM ═══ */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-text-primary font-heading mb-1">
          Ajouter une taille
        </h2>
        <p className="text-xs text-text-muted font-body mb-4">
          {pfsEnabled
            ? "Chaque taille doit être liée à une référence Paris Fashion Shop pour pouvoir être publiée."
            : "Référence Paris Fashion Shop indisponible pour l'instant — réessayez plus tard."}
        </p>

        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className="block text-xs font-semibold text-text-secondary font-body mb-1.5">
              Nom <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
              placeholder="ex : M, 42, T38, Taille unique"
              className="field-input w-full text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary font-body mb-1.5">
              Référence Paris Fashion Shop <span className="text-[#EF4444]">*</span>
            </label>
            <CustomSelect
              value={newPfsRef}
              onChange={(v) => setNewPfsRef(v)}
              options={pfsOptionsForCreate}
              placeholder="Choisir une référence…"
              emptyMessage="Aucune référence trouvée"
              searchable
              disabled={!pfsEnabled}
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={!newName.trim() || !newPfsRef || isPending || !pfsEnabled}
            className="btn-primary"
          >
            Créer
          </button>
        </div>

        {createError && (
          <p className="text-xs text-[#DC2626] font-body mt-3" role="alert">
            {createError}
          </p>
        )}
      </div>

      {/* ═══ ORPHAN BANNER ═══ */}
      {pfsEnabled && orphanCount > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#7F1D1D]">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-[#DC2626] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs font-body font-medium">
              <span className="font-semibold">{orphanCount}</span>{" "}
              {orphanCount > 1 ? "tailles sans référence" : "taille sans référence"} Paris Fashion Shop. Obligatoire pour publier sur PFS.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFilterOrphansOnly((v) => !v)}
            className="text-xs text-[#DC2626] hover:text-[#7F1D1D] font-semibold font-body underline underline-offset-2"
          >
            {filterOrphansOnly ? "Voir tout" : "Filtrer"}
          </button>
        </div>
      )}

      {/* ═══ SIZES LIST ═══ */}
      <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary font-heading">
            Tailles existantes ({sizes.length})
          </h2>
          {pfsEnabled && (
            <span className="text-[11px] text-text-muted font-body">
              {sizes.length - orphanCount}/{sizes.length} mappées PFS
            </span>
          )}
        </div>

        {sortedSizes.length === 0 ? (
          <p className="text-sm text-text-secondary font-body p-6">
            {filterOrphansOnly ? "Toutes les tailles sont mappées PFS." : "Aucune taille créée."}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {sortedSizes.map((size, index) => {
              const isOrphan = pfsEnabled && size.pfsSizeRef == null;
              const isProtected = isProtectedSizeName(size.name);
              return (
                <div
                  key={size.id}
                  className={`group flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary/50 transition-colors ${
                    isOrphan ? "border-l-2 border-l-[#EF4444] bg-[#FEF2F2]/30" : ""
                  }`}
                >
                  {/* Reorder arrows */}
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveSize(index, -1)}
                      disabled={index === 0}
                      className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors rounded"
                      title="Monter"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSize(index, 1)}
                      disabled={index === sortedSizes.length - 1}
                      className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors rounded"
                      title="Descendre"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  </div>

                  {editId === size.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdate();
                          if (e.key === "Escape") cancelEdit();
                        }}
                        className="field-input flex-1 text-sm"
                        autoFocus
                      />
                      <button onClick={handleUpdate} disabled={isPending} className="btn-primary text-xs py-1.5 px-3">
                        OK
                      </button>
                      <button onClick={cancelEdit} className="btn-secondary text-xs py-1.5 px-3">
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-text-primary font-heading">
                            {size.name}
                          </span>
                          {isOrphan && (
                            <span className="badge badge-error text-[10px]">PFS requis</span>
                          )}
                          {isProtected && (
                            <span className="badge badge-neutral text-[10px]">Verrouillée</span>
                          )}
                        </div>
                      </div>

                      {/* PFS single-ref CustomSelect */}
                      {pfsEnabled && (
                        <div className="shrink-0 w-56">
                          <CustomSelect
                            value={size.pfsSizeRef ?? ""}
                            onChange={(v) => handleSetPfsRef(size.id, v)}
                            options={pfsOptions}
                            size="sm"
                            searchable
                            placeholder="Choisir une réf PFS…"
                            emptyMessage="Aucune référence"
                            disabled={pfsSaving === size.id || isProtected}
                            aria-label={`Référence PFS pour ${size.name}`}
                          />
                        </div>
                      )}

                      <div className="shrink-0">
                        {size.variantCount > 0 ? (
                          <span className="badge badge-neutral text-[10px]">
                            {size.variantCount} variante{size.variantCount > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-text-muted text-[11px] font-body">Inutilisée</span>
                        )}
                      </div>

                      {!isProtected && (
                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(size)}
                            className="p-2 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-bg-secondary"
                            title="Modifier"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m16.862 4.487 1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(size)}
                            disabled={size.variantCount > 0}
                            className="p-2 text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-bg-secondary"
                            title={size.variantCount > 0 ? "Utilisée dans des variantes" : "Supprimer"}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

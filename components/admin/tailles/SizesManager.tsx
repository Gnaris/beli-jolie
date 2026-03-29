"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSize, updateSize, deleteSize, toggleSizePfsMapping } from "@/app/actions/admin/sizes";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { usePfsAttributes } from "@/components/admin/MarketplaceMappingSection";
import PfsSizeMultiSelect from "@/components/pfs/PfsSizeMultiSelect";

interface SizeItem {
  id: string;
  name: string;
  position: number;
  variantCount: number;
  categoryIds: string[];
  categoryNames: string[];
}

interface CategoryOption {
  id: string;
  name: string;
}

export default function SizesManager({
  initialSizes,
  categories,
}: {
  initialSizes: SizeItem[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  // Create form
  const [newName, setNewName] = useState("");
  const [newCategoryIds, setNewCategoryIds] = useState<string[]>([]);
  const [newPfsSizeRefs, setNewPfsSizeRefs] = useState<Set<string>>(new Set());

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategoryIds, setEditCategoryIds] = useState<string[]>([]);

  // PFS data for size mapping
  const { data: pfsData, loading: pfsLoading, error: pfsError, retry: pfsRetry } = usePfsAttributes();

  function toggleNewPfsSize(ref: string) {
    setNewPfsSizeRefs((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  function handleCreate() {
    if (!newName.trim()) return;
    if (newPfsSizeRefs.size === 0) {
      toast.error("La correspondance PFS est requise. Sélectionnez au moins une taille PFS.");
      return;
    }
    const selectedPfsRefs = [...newPfsSizeRefs];
    showLoading();
    startTransition(async () => {
      try {
        const created = await createSize(newName, newCategoryIds);
        // Apply PFS size mappings after creation
        for (const ref of selectedPfsRefs) {
          await toggleSizePfsMapping(created.id, ref);
        }
        setNewName("");
        setNewPfsSizeRefs(new Set());
        toast.success(`Taille « ${newName.trim()} » créée.`);
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
      } finally {
        hideLoading();
      }
    });
  }

  function startEdit(size: SizeItem) {
    setEditId(size.id);
    setEditName(size.name);
    setEditCategoryIds(size.categoryIds);
  }

  function handleUpdate() {
    if (!editId || !editName.trim()) return;
    showLoading();
    startTransition(async () => {
      try {
        await updateSize(editId, editName, editCategoryIds);
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

  function toggleCategory(categoryId: string, list: string[], setter: (v: string[]) => void) {
    setter(
      list.includes(categoryId)
        ? list.filter((id) => id !== categoryId)
        : [...list, categoryId]
    );
  }

  return (
    <>
      {/* Create form */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-text-primary font-heading mb-4">
          Nouvelle taille
        </h2>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nom de la taille (ex: XS, 17, Taille unique)"
            className="field-input flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || isPending}
            className="btn-primary whitespace-nowrap"
          >
            + Créer
          </button>
        </div>

        {/* Category checkboxes for new size */}
        {categories.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-text-secondary mb-2 font-body">
              Associer aux catégories :
            </p>
            <CategoryPicker
              categories={categories}
              selected={newCategoryIds}
              onToggle={(catId) => toggleCategory(catId, newCategoryIds, setNewCategoryIds)}
            />
          </div>
        )}

        {/* PFS Size Mapping — hidden when PFS is disabled */}
        {!pfsData?.pfsDisabled && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-bg-secondary border-b border-border flex items-center justify-between">
            <p className="text-xs font-semibold text-text-secondary font-body uppercase tracking-wider">
              Mapping Marketplaces
            </p>
            <span className="text-[10px] text-text-muted font-semibold font-body">Optionnel</span>
          </div>
          <div className="p-4">
            <p className="text-xs font-medium text-text-primary font-body mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-500 inline-block shrink-0" />
              Paris Fashion Shop
            </p>
            {pfsLoading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm font-body">
                <div className="animate-spin h-4 w-4 border-2 border-text-secondary border-t-transparent rounded-full shrink-0" />
                Chargement…
              </div>
            ) : pfsError ? (
              <div className="space-y-1">
                <p className="text-xs text-red-500 font-body">
                  Mapping non disponible
                </p>
                <p className="text-[11px] text-text-muted font-body break-all">
                  {pfsError}
                </p>
                <button
                  type="button"
                  onClick={pfsRetry}
                  className="text-xs text-text-secondary hover:text-text-primary underline font-body transition-colors"
                >
                  Réessayer
                </button>
              </div>
            ) : pfsData?.sizes ? (
              <PfsSizeMultiSelect
                pfsSizes={pfsData.sizes}
                selected={newPfsSizeRefs}
                onToggle={toggleNewPfsSize}
                disabled={false}
                className="w-full max-w-sm"
              />
            ) : (
              <p className="text-xs text-text-muted font-body">
                Aucune taille PFS disponible
              </p>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Sizes list */}
      <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary font-heading">
            Tailles existantes ({initialSizes.length})
          </h2>
        </div>

        {initialSizes.length === 0 ? (
          <p className="text-sm text-text-secondary font-body p-6">
            Aucune taille créée.
          </p>
        ) : editId ? (
          /* Edit mode - inline form */
          <div className="p-6 space-y-3">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="field-input w-full"
              onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
            />
            <CategoryPicker
              categories={categories}
              selected={editCategoryIds}
              onToggle={(catId) => toggleCategory(catId, editCategoryIds, setEditCategoryIds)}
            />
            <div className="flex gap-2">
              <button onClick={handleUpdate} disabled={isPending} className="btn-primary text-xs">
                Enregistrer
              </button>
              <button onClick={() => setEditId(null)} className="btn-secondary text-xs">
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Nom</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Catégories</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Variantes</th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {initialSizes.map((size) => (
                  <tr key={size.id} className="hover:bg-bg-secondary/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-text-primary font-heading">{size.name}</span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {size.categoryNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {size.categoryNames.map((name) => (
                            <span
                              key={name}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-bg-primary border border-border text-text-secondary"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {size.variantCount > 0 ? (
                        <span className="badge badge-neutral text-[10px]">{size.variantCount}</span>
                      ) : (
                        <span className="text-text-muted text-xs">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </>
  );
}

/* ─────────────────────────────────────────────
   Searchable, scrollable category picker
   ───────────────────────────────────────────── */

function CategoryPicker({
  categories,
  selected,
  onToggle,
}: {
  categories: CategoryOption[];
  selected: string[];
  onToggle: (catId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : categories;

  // Show selected first, then unselected
  const sorted = [...filtered].sort((a, b) => {
    const aSelected = selected.includes(a.id) ? 0 : 1;
    const bSelected = selected.includes(b.id) ? 0 : 1;
    return aSelected - bSelected || a.name.localeCompare(b.name);
  });

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Search */}
      {categories.length > 8 && (
        <div className="px-3 py-2 border-b border-border bg-bg-secondary">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une catégorie…"
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg bg-bg-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[#1A1A1A] font-body"
            />
          </div>
        </div>
      )}

      {/* Scrollable list */}
      <div className="max-h-48 overflow-y-auto p-2 space-y-0.5">
        {sorted.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-3 font-body">Aucune catégorie trouvée</p>
        ) : (
          sorted.map((cat) => {
            const isChecked = selected.includes(cat.id);
            return (
              <label
                key={cat.id}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors font-body ${
                  isChecked
                    ? "bg-bg-dark text-text-inverse"
                    : "text-text-primary hover:bg-bg-secondary"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(cat.id)}
                  className="sr-only"
                />
                <span className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors ${
                  isChecked ? "bg-bg-primary border-white" : "border-border bg-bg-primary"
                }`}>
                  {isChecked && (
                    <svg className="w-2.5 h-2.5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{cat.name}</span>
              </label>
            );
          })
        )}
      </div>

      {/* Footer: count */}
      {selected.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border bg-bg-secondary">
          <p className="text-[10px] text-text-secondary font-body">
            {selected.length} catégorie{selected.length > 1 ? "s" : ""} sélectionnée{selected.length > 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

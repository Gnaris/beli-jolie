"use client";

import { useState, useTransition } from "react";
import { createSize, updateSize, deleteSize, toggleSizePfsMapping } from "@/app/actions/admin/sizes";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
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
  const [sizes, setSizes] = useState(initialSizes);
  const [isPending, startTransition] = useTransition();
  const { confirm } = useConfirm();
  const toast = useToast();

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
    const selectedPfsRefs = [...newPfsSizeRefs];
    startTransition(async () => {
      try {
        const created = await createSize(newName, newCategoryIds);
        // Apply PFS size mappings after creation
        for (const ref of selectedPfsRefs) {
          await toggleSizePfsMapping(created.id, ref);
        }
        setNewName("");
        setNewCategoryIds([]);
        setNewPfsSizeRefs(new Set());
        toast.success(`Taille « ${newName.trim()} » créée.`);
        window.location.reload();
      } catch (err: unknown) {
        toast.error((err as Error).message);
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
    startTransition(async () => {
      try {
        await updateSize(editId, editName, editCategoryIds);
        setEditId(null);
        toast.success("Taille mise à jour.");
        window.location.reload();
      } catch (err: unknown) {
        toast.error((err as Error).message);
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
    startTransition(async () => {
      try {
        await deleteSize(size.id);
        setSizes((prev) => prev.filter((s) => s.id !== size.id));
        toast.success("Taille supprimée.");
      } catch (err: unknown) {
        toast.error((err as Error).message);
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
        <h2 className="text-sm font-semibold text-text-primary font-[family-name:var(--font-poppins)] mb-4">
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
            <p className="text-xs text-text-secondary mb-2 font-[family-name:var(--font-roboto)]">
              Associer aux catégories :
            </p>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <label
                  key={cat.id}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors ${
                    newCategoryIds.includes(cat.id)
                      ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                      : "bg-bg-secondary text-text-primary border-border hover:border-[#1A1A1A]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={newCategoryIds.includes(cat.id)}
                    onChange={() => toggleCategory(cat.id, newCategoryIds, setNewCategoryIds)}
                    className="sr-only"
                  />
                  {cat.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* PFS Size Mapping */}
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-bg-secondary border-b border-border flex items-center justify-between">
            <p className="text-xs font-semibold text-text-secondary font-[family-name:var(--font-roboto)] uppercase tracking-wider">
              Mapping Marketplaces
            </p>
            <span className="text-[10px] text-text-muted font-[family-name:var(--font-roboto)]">Optionnel</span>
          </div>
          <div className="p-4">
            <p className="text-xs font-medium text-text-primary font-[family-name:var(--font-roboto)] mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-500 inline-block shrink-0" />
              Paris Fashion Shop
            </p>
            {pfsLoading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm font-[family-name:var(--font-roboto)]">
                <div className="animate-spin h-4 w-4 border-2 border-text-secondary border-t-transparent rounded-full shrink-0" />
                Chargement…
              </div>
            ) : pfsError ? (
              <div className="space-y-1">
                <p className="text-xs text-red-500 font-[family-name:var(--font-roboto)]">
                  Mapping non disponible
                </p>
                <p className="text-[11px] text-text-muted font-[family-name:var(--font-roboto)] break-all">
                  {pfsError}
                </p>
                <button
                  type="button"
                  onClick={pfsRetry}
                  className="text-xs text-text-secondary hover:text-text-primary underline font-[family-name:var(--font-roboto)] transition-colors"
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
              <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                Aucune taille PFS disponible
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Sizes list */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-text-primary font-[family-name:var(--font-poppins)] mb-4">
          Tailles existantes ({sizes.length})
        </h2>

        {sizes.length === 0 ? (
          <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)]">
            Aucune taille créée.
          </p>
        ) : (
          <div className="space-y-2">
            {sizes.map((size) => (
              <div
                key={size.id}
                className="flex items-start gap-3 p-3 rounded-xl border border-border bg-bg-secondary"
              >
                {editId === size.id ? (
                  /* Edit mode */
                  <div className="flex-1 space-y-3">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="field-input w-full"
                      onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                    />
                    <div className="flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <label
                          key={cat.id}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                            editCategoryIds.includes(cat.id)
                              ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                              : "bg-bg-primary text-text-primary border-border hover:border-[#1A1A1A]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={editCategoryIds.includes(cat.id)}
                            onChange={() => toggleCategory(cat.id, editCategoryIds, setEditCategoryIds)}
                            className="sr-only"
                          />
                          {cat.name}
                        </label>
                      ))}
                    </div>
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
                  /* Display mode */
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary font-[family-name:var(--font-poppins)]">
                          {size.name}
                        </span>
                        {size.variantCount > 0 && (
                          <span className="badge badge-neutral text-[10px]">
                            {size.variantCount} variante{size.variantCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      {size.categoryNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {size.categoryNames.map((name) => (
                            <span
                              key={name}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-bg-primary border border-border text-text-secondary"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(size)}
                        className="p-2 rounded-lg hover:bg-bg-primary transition-colors"
                        title="Modifier"
                      >
                        <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m16.862 4.487 1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(size)}
                        disabled={size.variantCount > 0}
                        className="p-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={size.variantCount > 0 ? "Utilisée dans des variantes" : "Supprimer"}
                      >
                        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  );
}

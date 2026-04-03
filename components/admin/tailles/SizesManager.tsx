"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  createSizesBatch,
  updateSize,
  deleteSize,
  reorderSizes,
  toggleSizePfsMapping,
} from "@/app/actions/admin/sizes";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import PfsSizeMultiSelect from "@/components/pfs/PfsSizeMultiSelect";

interface SizeItem {
  id: string;
  name: string;
  position: number;
  variantCount: number;
  categoryIds: string[];
  categoryNames: string[];
  pfsMappings: string[];
}

interface CategoryOption {
  id: string;
  name: string;
}

// ─────────────────────────────────────────────
// Preset groups for quick add
// ─────────────────────────────────────────────
const PRESETS = [
  { label: "Standard", sizes: "XS, S, M, L, XL, XXL" },
  { label: "Chaussures", sizes: "36, 37, 38, 39, 40, 41, 42, 43, 44, 45" },
  { label: "Pantalons", sizes: "T34, T36, T38, T40, T42, T44, T46" },
  { label: "Unique", sizes: "Taille unique" },
];

export default function SizesManager({
  initialSizes,
  categories,
  pfsEnabled = false,
  pfsSizes = [],
}: {
  initialSizes: SizeItem[];
  categories: CategoryOption[];
  pfsEnabled?: boolean;
  pfsSizes?: { reference: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  // Create form
  const [inputValue, setInputValue] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Edit state (per-row inline)
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategoryIds, setEditCategoryIds] = useState<string[]>([]);

  // Local sizes for reorder
  const [sizes, setSizes] = useState(initialSizes);
  useEffect(() => { setSizes(initialSizes); }, [initialSizes]);

  // PFS mapping state (local copy for instant feedback)
  const [pfsMappingsMap, setPfsMappingsMap] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(initialSizes.map((s) => [s.id, s.pfsMappings]))
  );
  useEffect(() => {
    setPfsMappingsMap(Object.fromEntries(initialSizes.map((s) => [s.id, s.pfsMappings])));
  }, [initialSizes]);
  const [pfsSaving, setPfsSaving] = useState<string | null>(null);

  // Inline category add dropdown (per-row)
  const [catDropdownId, setCatDropdownId] = useState<string | null>(null);

  // ─────────────────────────────────────────────
  // Tag input logic
  // ─────────────────────────────────────────────
  function addTagsFromInput(value: string) {
    const newTags = value
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !tags.includes(s));
    if (newTags.length > 0) {
      setTags((prev) => [...prev, ...newTags]);
    }
    setInputValue("");
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (inputValue.trim()) {
        addTagsFromInput(inputValue);
      } else if (tags.length > 0) {
        handleCreate();
      }
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function applyPreset(preset: string) {
    const newTags = preset
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !tags.includes(s));
    setTags((prev) => [...prev, ...newTags]);
    setInputValue("");
    inputRef.current?.focus();
  }

  // ─────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────
  function handleCreate() {
    // Include any remaining input text
    const allNames = [...tags];
    if (inputValue.trim()) {
      const remaining = inputValue
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      allNames.push(...remaining);
    }
    const unique = Array.from(new Set(allNames)).filter(Boolean);
    if (unique.length === 0) return;

    showLoading();
    startTransition(async () => {
      try {
        const result = await createSizesBatch(unique, selectedCategoryIds);
        setTags([]);
        setInputValue("");
        const msg =
          result.created === 1
            ? `Taille créée.`
            : `${result.created} tailles créées.`;
        const skip =
          result.skipped.length > 0
            ? ` (déjà existantes : ${result.skipped.join(", ")})`
            : "";
        toast.success(msg + skip);
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

  function cancelEdit() {
    setEditId(null);
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

  // ─────────────────────────────────────────────
  // Inline category toggle (add/remove without edit mode)
  // ─────────────────────────────────────────────
  function handleInlineCategoryToggle(size: SizeItem, categoryId: string) {
    const currentIds = size.categoryIds;
    const newIds = currentIds.includes(categoryId)
      ? currentIds.filter((id) => id !== categoryId)
      : [...currentIds, categoryId];

    startTransition(async () => {
      try {
        await updateSize(size.id, size.name, newIds);
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  // ─────────────────────────────────────────────
  // PFS mapping
  // ─────────────────────────────────────────────
  async function handleTogglePfsMapping(sizeId: string, pfsSizeRef: string) {
    setPfsSaving(sizeId);
    try {
      const updated = await toggleSizePfsMapping(sizeId, pfsSizeRef);
      setPfsMappingsMap((prev) => ({ ...prev, [sizeId]: updated }));
    } catch (err: unknown) {
      toast.error((err as Error).message);
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
      if (newIndex < 0 || newIndex >= sizes.length) return;
      const newSizes = [...sizes];
      [newSizes[index], newSizes[newIndex]] = [newSizes[newIndex], newSizes[index]];
      setSizes(newSizes);
      // Persist
      startTransition(async () => {
        try {
          await reorderSizes(newSizes.map((s) => s.id));
        } catch {
          // Revert on error
          setSizes(initialSizes);
        }
      });
    },
    [sizes, initialSizes, startTransition]
  );

  return (
    <>
      {/* ═══ CREATE FORM ═══ */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="text-sm font-semibold text-text-primary font-heading mb-1">
          Ajouter des tailles
        </h2>
        <p className="text-xs text-text-muted font-body mb-4">
          Séparez par des virgules pour en créer plusieurs d&apos;un coup.
        </p>

        {/* Tag input */}
        <div
          className="flex flex-wrap items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-xl border border-border bg-bg-primary focus-within:border-text-primary transition-colors cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-dark text-text-inverse text-xs font-medium font-body animate-[fadeIn_0.15s_ease-out]"
            >
              {tag}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="ml-0.5 hover:opacity-70 transition-opacity"
                aria-label={`Retirer ${tag}`}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={() => {
              if (inputValue.trim()) addTagsFromInput(inputValue);
            }}
            placeholder={tags.length === 0 ? "XS, S, M, L, XL, XXL…" : ""}
            className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted font-body"
          />
        </div>

        {/* Presets */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-[11px] text-text-muted font-body">Rapide :</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.sizes)}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-border text-text-secondary hover:border-text-primary hover:text-text-primary transition-colors font-body"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Category association */}
        {categories.length > 0 && (
          <div className="mt-4">
            <label className="text-xs font-medium text-text-secondary font-body mb-2 block">
              Associer aux catégories
              {selectedCategoryIds.length > 0 && (
                <span className="badge badge-neutral text-[10px] ml-2">{selectedCategoryIds.length}</span>
              )}
            </label>
            <CategoryPicker
              categories={categories}
              selected={selectedCategoryIds}
              onToggle={(catId) =>
                setSelectedCategoryIds((prev) =>
                  prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
                )
              }
              onSelectAll={() => setSelectedCategoryIds(categories.map((c) => c.id))}
              onDeselectAll={() => setSelectedCategoryIds([])}
            />
          </div>
        )}

        {/* Create button */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleCreate}
            disabled={tags.length === 0 && !inputValue.trim() || isPending}
            className="btn-primary"
          >
            {tags.length > 1
              ? `Créer ${tags.length} tailles`
              : tags.length === 1
                ? `Créer « ${tags[0]} »`
                : "Créer"}
          </button>
          {tags.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setTags([]);
                setInputValue("");
              }}
              className="text-xs text-text-muted hover:text-text-primary transition-colors font-body"
            >
              Tout effacer
            </button>
          )}
        </div>
      </div>

      {/* ═══ SIZES LIST ═══ */}
      <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary font-heading">
            Tailles existantes ({sizes.length})
          </h2>
        </div>

        {sizes.length === 0 ? (
          <p className="text-sm text-text-secondary font-body p-6">
            Aucune taille créée.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {sizes.map((size, index) => (
              <div
                key={size.id}
                className="group flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary/50 transition-colors"
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
                    disabled={index === sizes.length - 1}
                    className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors rounded"
                    title="Descendre"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>

                {editId === size.id ? (
                  /* ─── Inline edit ─── */
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
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
                    {categories.length > 0 && (
                      <CategoryPicker
                        categories={categories}
                        selected={editCategoryIds}
                        onToggle={(catId) =>
                          setEditCategoryIds((prev) =>
                            prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
                          )
                        }
                        onSelectAll={() => setEditCategoryIds(categories.map((c) => c.id))}
                        onDeselectAll={() => setEditCategoryIds([])}
                      />
                    )}
                  </div>
                ) : (
                  /* ─── Display row ─── */
                  <>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm text-text-primary font-heading">
                        {size.name}
                      </span>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {size.categoryIds.map((catId, ci) => (
                          <span
                            key={catId}
                            className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-bg-secondary border border-border text-text-secondary group/cat"
                          >
                            {size.categoryNames[ci]}
                            <button
                              type="button"
                              onClick={() => handleInlineCategoryToggle(size, catId)}
                              className="ml-0.5 opacity-0 group-hover/cat:opacity-100 hover:text-[#EF4444] transition-all"
                              title={`Retirer ${size.categoryNames[ci]}`}
                            >
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                        {/* Add category button */}
                        {categories.length > size.categoryIds.length && (
                          <InlineCategoryTrigger
                            isOpen={catDropdownId === size.id}
                            onToggle={() => setCatDropdownId(catDropdownId === size.id ? null : size.id)}
                            categories={categories}
                            selectedIds={size.categoryIds}
                            onCategoryToggle={(catId) => handleInlineCategoryToggle(size, catId)}
                            onClose={() => setCatDropdownId(null)}
                          />
                        )}
                      </div>
                    </div>

                    {/* PFS mapping */}
                    {pfsEnabled && pfsSizes.length > 0 && (
                      <div className="shrink-0 w-48">
                        {pfsSaving === size.id ? (
                          <span className="text-[11px] text-text-muted font-body">...</span>
                        ) : (
                          <PfsSizeMultiSelect
                            pfsSizes={pfsSizes}
                            selected={new Set(pfsMappingsMap[size.id] ?? [])}
                            onToggle={(ref) => handleTogglePfsMapping(size.id, ref)}
                          />
                        )}
                      </div>
                    )}

                    {/* Variant count */}
                    <div className="shrink-0">
                      {size.variantCount > 0 ? (
                        <span className="badge badge-neutral text-[10px]">
                          {size.variantCount} variante{size.variantCount > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-text-muted text-[11px] font-body">Inutilisée</span>
                      )}
                    </div>

                    {/* Actions */}
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

/* ─────────────────────────────────────────────
   Large dropdown category picker with "Select all"
   ───────────────────────────────────────────── */

function CategoryPicker({
  categories,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  categories: { id: string; name: string }[];
  selected: string[];
  onToggle: (catId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : categories;

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.includes(c.id));

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Search + select all header */}
      <div className="px-3 py-2 border-b border-border bg-bg-secondary space-y-2">
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
        <label
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors font-body font-semibold ${
            allFilteredSelected
              ? "bg-bg-dark text-text-inverse"
              : "text-text-primary hover:bg-bg-secondary"
          }`}
          onClick={(e) => {
            e.preventDefault();
            if (allFilteredSelected) {
              onDeselectAll();
            } else {
              onSelectAll();
            }
          }}
        >
          <span className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors ${
            allFilteredSelected ? "bg-bg-primary border-white" : "border-border bg-bg-primary"
          }`}>
            {allFilteredSelected && (
              <svg className="w-2.5 h-2.5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </span>
          <span>Toutes les catégories</span>
        </label>
      </div>

      <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-3 font-body">Aucune catégorie trouvée</p>
        ) : (
          filtered.map((cat) => {
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

      {selected.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border bg-bg-secondary flex items-center justify-between">
          <p className="text-[10px] text-text-secondary font-body">
            {selected.length} catégorie{selected.length > 1 ? "s" : ""} sélectionnée{selected.length > 1 ? "s" : ""}
          </p>
          <button
            type="button"
            onClick={onDeselectAll}
            className="text-[10px] text-[#EF4444] hover:text-[#DC2626] font-medium font-body transition-colors"
          >
            Tout désélectionner
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Inline category trigger + portal dropdown
   ───────────────────────────────────────────── */

function InlineCategoryTrigger({
  isOpen,
  onToggle,
  categories,
  selectedIds,
  onCategoryToggle,
  onClose,
}: {
  isOpen: boolean;
  onToggle: () => void;
  categories: { id: string; name: string }[];
  selectedIds: string[];
  onCategoryToggle: (catId: string) => void;
  onClose: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onToggle}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-border text-text-muted hover:border-text-primary hover:text-text-primary transition-colors"
        title="Ajouter une catégorie"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
      {isOpen && (
        <InlineCategoryDropdown
          anchorRef={btnRef}
          categories={categories}
          selectedIds={selectedIds}
          onToggle={onCategoryToggle}
          onClose={onClose}
        />
      )}
    </>
  );
}

function InlineCategoryDropdown({
  anchorRef,
  categories,
  selectedIds,
  onToggle,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  categories: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (catId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position relative to anchor
  useEffect(() => {
    function update() {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef]);

  // Auto-focus search
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target) && !anchorRef.current?.contains(target)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const unselected = categories.filter((c) => !selectedIds.includes(c.id));
  const filtered = search.trim()
    ? unselected.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : unselected;

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] w-56 bg-bg-primary border border-border rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
      style={{ top: pos.top, left: pos.left, animation: "customSelectDown 0.15s ease-out" }}
    >
      <div className="px-2 pt-2 pb-1.5 border-b border-border">
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="w-full pl-6 pr-2.5 py-1.5 text-[11px] border border-border rounded-lg focus:outline-none focus:border-[#1A1A1A] bg-bg-secondary font-body text-text-primary placeholder:text-text-muted"
          />
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-text-muted text-center font-body">
            {unselected.length === 0 ? "Toutes les catégories sont déjà liées" : "Aucun résultat"}
          </p>
        ) : (
          filtered.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                onToggle(cat.id);
                onClose();
              }}
              className="w-full text-left px-3 py-2 text-[11px] text-text-primary hover:bg-bg-secondary transition-colors font-body truncate"
            >
              {cat.name}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body
  );
}

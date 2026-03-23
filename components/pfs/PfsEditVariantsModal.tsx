"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { StagedProductFull, StagedVariantData, StagedImageGroup } from "./PfsProductDetailModal";
import ColorSwatch from "@/components/ui/ColorSwatch";
import CustomSelect from "@/components/ui/CustomSelect";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import type { QuickCreateType } from "@/components/admin/products/QuickCreateModal";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ColorOption {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
}

interface OrphanDecision {
  action: "reassign" | "delete";
  targetColorRef: string;
}

interface PfsEditVariantsModalProps {
  product: StagedProductFull;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: StagedProductFull) => void;
}

/** All selected colors for a variant (main + sub) as a flat ordered list */
interface SelectedColor {
  colorId: string;
  colorName: string;
  hex: string | null;
  patternImage: string | null;
}

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Helper: get all selected colors from a variant
// ─────────────────────────────────────────────

function getSelectedColors(v: StagedVariantData, colorOptions: ColorOption[]): SelectedColor[] {
  const colors: SelectedColor[] = [];
  // First color (main)
  const main = colorOptions.find((c) => c.id === v.colorId);
  colors.push({
    colorId: v.colorId,
    colorName: main?.name ?? v.colorName,
    hex: main?.hex ?? v.colorHex ?? null,
    patternImage: main?.patternImage ?? v.colorPatternImage ?? null,
  });
  // Additional colors (subColors)
  for (const sc of v.subColors ?? []) {
    const opt = colorOptions.find((c) => c.id === sc.colorId);
    colors.push({
      colorId: sc.colorId,
      colorName: opt?.name ?? sc.colorName,
      hex: opt?.hex ?? sc.hex ?? null,
      patternImage: opt?.patternImage ?? sc.patternImage ?? null,
    });
  }
  return colors;
}

/** Build swatch segments from selected colors */
function swatchSegments(selected: SelectedColor[]): { hex?: string | null; patternImage?: string | null }[] | undefined {
  if (selected.length <= 1) return undefined;
  return selected.slice(1).map((c) => ({ hex: c.hex, patternImage: c.patternImage }));
}

// ─────────────────────────────────────────────
// Color Multi-Select Dropdown
// ─────────────────────────────────────────────

function ColorMultiSelect({
  selected,
  colorOptions,
  onToggle,
  onRemove,
  onQuickCreate,
  loading,
}: {
  selected: SelectedColor[];
  colorOptions: ColorOption[];
  onToggle: (colorId: string) => void;
  onRemove: (colorId: string) => void;
  onQuickCreate: () => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on click outside + Escape key
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setSearch(""); }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const selectedIds = new Set(selected.map((c) => c.colorId));

  const filtered = colorOptions.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative w-full">
      {/* Selected chips + trigger */}
      <div
        role="combobox"
        tabIndex={0}
        aria-expanded={open}
        aria-controls="color-listbox"
        aria-haspopup="listbox"
        aria-label="Sélection de couleurs"
        className="min-h-[44px] max-h-28 overflow-y-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-bg-primary px-2.5 py-1.5 cursor-pointer transition-colors hover:border-text-secondary focus:outline-none focus:ring-2 focus:ring-text-primary/20"
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); } }}
      >
        {loading ? (
          <div className="h-5 w-24 rounded bg-bg-secondary animate-pulse" />
        ) : selected.length === 0 ? (
          <span className="text-sm text-text-secondary">Sélectionner des couleurs…</span>
        ) : (
          selected.map((c) => (
            <span
              key={c.colorId}
              className="inline-flex items-center gap-1 rounded-lg bg-bg-secondary px-2 py-1 text-xs text-text-primary"
            >
              <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={14} rounded="full" border />
              {c.colorName}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(c.colorId); }}
                className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-text-secondary hover:text-[#EF4444] transition-colors"
                aria-label={`Retirer ${c.colorName}`}
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div id="color-listbox" role="listbox" aria-label="Liste des couleurs" className="absolute z-20 mt-1 w-full max-h-64 rounded-xl border border-border bg-bg-primary shadow-lg overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <SearchIcon className="h-4 w-4 text-text-secondary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              aria-label="Rechercher une couleur"
              className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-secondary"
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onQuickCreate(); setOpen(false); setSearch(""); }}
              className="flex h-9 items-center gap-1 rounded-lg bg-bg-secondary px-2.5 text-xs font-medium text-text-secondary hover:bg-border hover:text-text-primary transition-colors shrink-0"
              title="Créer une couleur"
            >
              <PlusIcon className="h-3 w-3" />
              Créer
            </button>
          </div>

          {/* Options list */}
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-text-secondary text-center py-3">Aucune couleur trouvée</p>
            ) : (
              filtered.map((c) => {
                const isSelected = selectedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => { e.stopPropagation(); onToggle(c.id); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isSelected
                        ? "bg-text-primary/5 text-text-primary font-medium"
                        : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
                    }`}
                  >
                    <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={18} rounded="full" border />
                    <span className="flex-1 text-left truncate">{c.name}</span>
                    {isSelected && (
                      <svg className="h-4 w-4 text-[#22C55E] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function PfsEditVariantsModal({
  product,
  open,
  onClose,
  onSaved,
}: PfsEditVariantsModalProps) {
  // _tempId for stable React keys (not persisted)
  const tempIdRef = useRef(0);
  const nextTempId = () => `tmp-${++tempIdRef.current}`;

  const [variants, setVariants] = useState<(StagedVariantData & { _tempId: string })[]>(
    () => product.variants.map((v) => ({ ...v, subColors: v.subColors ? [...v.subColors] : [], _tempId: nextTempId() }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Color options from DB
  const [colorOptions, setColorOptions] = useState<ColorOption[]>([]);
  const [loadingColors, setLoadingColors] = useState(false);

  // QuickCreate modal
  const [quickCreateType, setQuickCreateType] = useState<QuickCreateType | null>(null);
  const [quickCreateForIdx, setQuickCreateForIdx] = useState<number | null>(null);

  // Orphaned images decisions (keyed by original colorRef)
  const [orphanDecisions, setOrphanDecisions] = useState<Map<string, OrphanDecision>>(new Map());

  // Fetch colors
  const fetchColors = useCallback(async () => {
    setLoadingColors(true);
    try {
      const res = await fetch("/api/admin/pfs-sync/entities");
      if (res.ok) {
        const data = await res.json();
        setColorOptions(data.colors || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingColors(false);
    }
  }, []);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      tempIdRef.current = 0;
      setVariants(product.variants.map((v) => ({ ...v, subColors: v.subColors ? [...v.subColors] : [], _tempId: nextTempId() })));
      setError(null);
      setOrphanDecisions(new Map());
      fetchColors();
    }
  }, [open, product.id, product.variants, fetchColors]);

  // ── Update variant field ──
  const updateVariant = (index: number, field: keyof StagedVariantData, value: unknown) => {
    setVariants((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  // ── Toggle a color in a variant's color list (add/remove) ──
  const toggleColor = (variantIdx: number, colorId: string) => {
    const color = colorOptions.find((c) => c.id === colorId);
    if (!color) return;

    setVariants((prev) => {
      const updated = [...prev];
      const v = { ...updated[variantIdx] };
      const subColors = [...(v.subColors ?? [])];

      // Is it the main color?
      if (v.colorId === colorId) {
        // Removing main color: promote first sub-color or clear
        if (subColors.length > 0) {
          const promoted = subColors.shift()!;
          v.colorId = promoted.colorId;
          v.colorName = promoted.colorName;
          v.colorRef = promoted.colorName.toUpperCase().replace(/\s+/g, "_");
          v.colorHex = promoted.hex;
          v.colorPatternImage = promoted.patternImage;
          v.subColors = subColors;
        } else {
          // Can't remove the only color — do nothing
          return prev;
        }
      } else if (subColors.some((sc) => sc.colorId === colorId)) {
        // Removing a sub-color
        v.subColors = subColors.filter((sc) => sc.colorId !== colorId);
      } else {
        // Adding a new color
        v.subColors = [
          ...subColors,
          { colorId: color.id, colorName: color.name, hex: color.hex, patternImage: color.patternImage },
        ];
      }

      updated[variantIdx] = v;
      return updated;
    });
  };

  // ── Remove a specific color by id ──
  const removeColor = (variantIdx: number, colorId: string) => {
    toggleColor(variantIdx, colorId);
  };

  // ── Delete a variant entirely ──
  const deleteVariant = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Build a full color key for a variant (includes all colors, not just main) ──
  const variantFullKey = (v: StagedVariantData) => {
    const parts = [v.colorRef];
    for (const sc of v.subColors ?? []) {
      parts.push(sc.colorName.toUpperCase().replace(/\s+/g, "_"));
    }
    return parts.join("::");
  };

  // ── Build a full color label for display ──
  const variantFullLabel = (v: StagedVariantData) => {
    const names = [v.colorName, ...(v.subColors ?? []).map((sc) => sc.colorName)];
    return names.join(", ");
  };

  // ── Orphaned images detection (real-time) ──
  // An image group is orphaned if no variant has EXACTLY the same color composition
  // i.e., image "NOIR" only matches a variant that is just "NOIR" alone,
  // not a variant "NOIR/ROUGE/JAUNE"
  const orphanedGroups = useMemo(() => {
    // Build set of full keys for all current variants
    const variantKeys = new Set(variants.map(variantFullKey));

    // Also build a map: original colorRef → original full key (from product.variants)
    // Images were linked to the original variant's colorRef
    const originalKeyByColorRef = new Map<string, string>();
    for (const ov of product.variants) {
      const key = variantFullKey(ov);
      originalKeyByColorRef.set(ov.colorRef, key);
    }

    return product.imagesByColor.filter((g) => {
      // What was the original full key for this image's colorRef?
      const originalKey = originalKeyByColorRef.get(g.colorRef) ?? g.colorRef;
      // Does any current variant still match this original key?
      return !variantKeys.has(originalKey);
    });
  }, [variants, product.imagesByColor, product.variants]);

  // ── Group variants by full color composition key ──
  const groupedVariants = useMemo(() => {
    const groups: { key: string; variants: { variant: (typeof variants)[number]; originalIdx: number }[] }[] = [];
    const keyIndex = new Map<string, number>();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const key = variantFullKey(v);
      const idx = keyIndex.get(key);
      if (idx !== undefined) {
        groups[idx].variants.push({ variant: v, originalIdx: i });
      } else {
        keyIndex.set(key, groups.length);
        groups.push({ key, variants: [{ variant: v, originalIdx: i }] });
      }
    }
    return groups;
  }, [variants]);

  // ── Delete all variants in a group ──
  const deleteGroup = (key: string) => {
    setVariants((prev) => prev.filter((v) => variantFullKey(v) !== key));
  };

  // Available variant color compositions for reassignment
  const variantColorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of variants) {
      const key = variantFullKey(v);
      if (!seen.has(key)) seen.set(key, variantFullLabel(v));
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ value: key, label }));
  }, [variants]);

  // Clean up orphan decisions
  useEffect(() => {
    if (orphanedGroups.length === 0) {
      setOrphanDecisions(new Map());
      return;
    }
    setOrphanDecisions((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (!orphanedGroups.some((g) => g.colorRef === key)) next.delete(key);
      }
      return next;
    });
  }, [orphanedGroups]);

  const setOrphanAction = (colorRef: string, action: "reassign" | "delete") => {
    setOrphanDecisions((prev) => {
      const next = new Map(prev);
      if (action === "delete") {
        next.set(colorRef, { action: "delete", targetColorRef: "" });
      } else {
        const current = next.get(colorRef);
        next.set(colorRef, { action: "reassign", targetColorRef: current?.targetColorRef || variantColorOptions[0]?.value || "" });
      }
      return next;
    });
  };

  const setOrphanTarget = (colorRef: string, targetColorRef: string) => {
    setOrphanDecisions((prev) => {
      const next = new Map(prev);
      next.set(colorRef, { action: "reassign", targetColorRef });
      return next;
    });
  };

  // ── Build final imagesByColor ──
  const buildFinalImages = (): StagedImageGroup[] => {
    // Non-orphaned images: those NOT in orphanedGroups
    const orphanColorRefs = new Set(orphanedGroups.map((g) => g.colorRef));
    const kept = product.imagesByColor
      .filter((g) => !orphanColorRefs.has(g.colorRef))
      .map((g) => {
        // Update colorId/colorName from current variant
        const v = variants.find((vv) => vv.colorRef === g.colorRef);
        return v ? { ...g, colorId: v.colorId, colorName: v.colorName } : g;
      });

    // Process orphan decisions
    for (const orphan of orphanedGroups) {
      const decision = orphanDecisions.get(orphan.colorRef);
      if (!decision || decision.action === "delete") continue;

      // targetColorRef is a full key (e.g. "NOIR::ROUGE::JAUNE")
      // Find the variant that matches this key to get its colorRef
      const targetV = variants.find((v) => variantFullKey(v) === decision.targetColorRef);
      if (!targetV) continue;

      // Merge into existing group or create new
      const targetIdx = kept.findIndex((g) => g.colorRef === targetV.colorRef);
      if (targetIdx >= 0) {
        kept[targetIdx] = { ...kept[targetIdx], paths: [...kept[targetIdx].paths, ...orphan.paths] };
      } else {
        kept.push({
          colorRef: targetV.colorRef,
          colorName: targetV.colorName,
          colorId: targetV.colorId,
          paths: orphan.paths,
        });
      }
    }
    return kept;
  };

  // All orphans must have an explicit decision
  const hasUnresolvedOrphans = orphanedGroups.some((g) => {
    const decision = orphanDecisions.get(g.colorRef);
    if (!decision) return true;
    if (decision.action === "reassign" && !decision.targetColorRef) return true;
    return false;
  });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Strip _tempId before sending
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cleanVariants = variants.map(({ _tempId, ...rest }) => rest);
      const body: Record<string, unknown> = { variants: cleanVariants };
      // Always send imagesByColor to keep colorId/colorName in sync with variants
      body.imagesByColor = buildFinalImages();

      const res = await fetch(`/api/admin/pfs-sync/staged/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }

      const { product: updated } = await res.json();
      const parsed: StagedProductFull = {
        ...product,
        ...updated,
        variants: typeof updated.variants === "string" ? JSON.parse(updated.variants) : updated.variants ?? product.variants,
        compositions: typeof updated.compositions === "string" ? JSON.parse(updated.compositions) : updated.compositions ?? product.compositions,
        translations: typeof updated.translations === "string" ? JSON.parse(updated.translations) : updated.translations ?? product.translations,
        imagesByColor: typeof updated.imagesByColor === "string" ? JSON.parse(updated.imagesByColor) : updated.imagesByColor ?? product.imagesByColor,
      };
      onSaved(parsed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div
          className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl bg-bg-primary shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
            <h3 className="text-base font-semibold text-text-primary font-[family-name:var(--font-poppins)]">
              Modifier les variantes
            </h3>
            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-bg-secondary text-text-secondary transition-colors hover:bg-border hover:text-text-primary"
              aria-label="Fermer"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Body — scrollable */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {variants.length === 0 ? (
              <p className="text-sm text-text-secondary py-4 text-center">Aucune variante</p>
            ) : (
              <div className="space-y-4">
                {groupedVariants.map((group) => {
                  const firstVariant = group.variants[0];
                  const selected = getSelectedColors(firstVariant.variant, colorOptions);
                  const firstIdx = firstVariant.originalIdx;

                  return (
                    <div
                      key={group.key}
                      className="rounded-xl border border-border bg-bg-secondary overflow-hidden"
                    >
                      {/* Color header: shared for all variants in this group */}
                      <div className="flex items-start gap-2 p-4 border-b border-border">
                        <div className="pt-2.5 shrink-0">
                          <ColorSwatch
                            hex={selected[0]?.hex ?? null}
                            patternImage={selected[0]?.patternImage ?? null}
                            subColors={swatchSegments(selected)}
                            size={24}
                            rounded="full"
                            border
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <ColorMultiSelect
                            selected={selected}
                            colorOptions={colorOptions}
                            onToggle={(colorId) => {
                              // Apply color change to ALL variants in this group
                              for (const gv of group.variants) toggleColor(gv.originalIdx, colorId);
                            }}
                            onRemove={(colorId) => {
                              for (const gv of group.variants) removeColor(gv.originalIdx, colorId);
                            }}
                            onQuickCreate={() => { setQuickCreateForIdx(firstIdx); setQuickCreateType("color"); }}
                            loading={loadingColors}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => deleteGroup(group.key)}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-[#EF4444]/10 hover:text-[#EF4444]"
                          aria-label="Supprimer ce groupe de variantes"
                          title="Supprimer ce groupe"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Variant rows */}
                      <div className="divide-y divide-border">
                        {group.variants.map(({ variant: v, originalIdx: i }) => (
                          <div key={v._tempId} className="p-4 space-y-3">
                            {/* Row header: type badge + delete single row */}
                            <div className="flex items-center gap-2">
                              <div className="flex rounded-lg border border-border overflow-hidden">
                                <button type="button" onClick={() => updateVariant(i, "saleType", "UNIT")}
                                  aria-pressed={v.saleType === "UNIT"}
                                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${v.saleType === "UNIT" ? "bg-text-primary text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"}`}>
                                  UNIT
                                </button>
                                <button type="button" onClick={() => updateVariant(i, "saleType", "PACK")}
                                  aria-pressed={v.saleType === "PACK"}
                                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${v.saleType === "PACK" ? "bg-text-primary text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"}`}>
                                  PACK
                                </button>
                              </div>

                              {group.variants.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => deleteVariant(i)}
                                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-[#EF4444]/10 hover:text-[#EF4444]"
                                  aria-label="Supprimer cette ligne"
                                  title="Supprimer cette ligne"
                                >
                                  <XIcon className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Fields grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                              <div>
                                <label className="field-label text-xs">Prix unitaire (€)</label>
                                <input type="number" value={v.unitPrice} onChange={(e) => updateVariant(i, "unitPrice", parseFloat(e.target.value) || 0)} min={0} step={0.01} className="field-input mt-1" />
                              </div>

                              <div>
                                <label className="field-label text-xs">Stock</label>
                                <input type="number" value={v.stock} onChange={(e) => updateVariant(i, "stock", parseInt(e.target.value) || 0)} min={0} className="field-input mt-1" />
                              </div>

                              <div>
                                <label className="field-label text-xs">Poids (kg)</label>
                                <input type="number" value={v.weight} onChange={(e) => updateVariant(i, "weight", parseFloat(e.target.value) || 0)} min={0} step={0.01} className="field-input mt-1" />
                              </div>

                              {v.saleType === "PACK" && (
                                <div>
                                  <label className="field-label text-xs">Qté pack</label>
                                  <input type="number" value={v.packQuantity ?? ""} onChange={(e) => updateVariant(i, "packQuantity", e.target.value ? parseInt(e.target.value) : null)} min={1} className="field-input mt-1" />
                                </div>
                              )}

                              <div>
                                <label className="field-label text-xs">Remise</label>
                                <select value={v.discountType ?? ""} onChange={(e) => { const val = e.target.value || null; updateVariant(i, "discountType", val); if (!val) updateVariant(i, "discountValue", null); }} className="field-input mt-1">
                                  <option value="">Aucune</option>
                                  <option value="PERCENT">Pourcentage</option>
                                  <option value="AMOUNT">Montant</option>
                                </select>
                              </div>

                              {v.discountType && (
                                <div>
                                  <label className="field-label text-xs">Valeur {v.discountType === "PERCENT" ? "(%)" : "(€)"}</label>
                                  <input type="number" value={v.discountValue ?? ""} onChange={(e) => updateVariant(i, "discountValue", e.target.value ? parseFloat(e.target.value) : null)} min={0} step={v.discountType === "PERCENT" ? 1 : 0.01} className="field-input mt-1" />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Orphaned images banner ── */}
            {orphanedGroups.length > 0 && (
              <div className="rounded-xl border-2 border-[#F59E0B]/40 bg-[#F59E0B]/5 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <WarningIcon className="h-5 w-5 text-[#F59E0B] shrink-0" />
                  <p className="text-sm font-medium text-text-primary">
                    Images sans couleur attribuée
                  </p>
                </div>
                <p className="text-xs text-text-secondary">
                  Ces images étaient associées à des couleurs qui n&apos;existent plus dans les variantes.
                  Réattribuez-les à une couleur existante ou supprimez-les pour pouvoir enregistrer.
                </p>

                {orphanedGroups.map((group) => {
                  const decision = orphanDecisions.get(group.colorRef);
                  const hasDecision = !!decision;
                  return (
                    <div key={group.colorRef} className={`rounded-xl border p-3 space-y-3 ${hasDecision ? "border-border bg-bg-primary" : "border-[#F59E0B]/30 bg-[#F59E0B]/5"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-primary">
                          {group.colorName}
                          <span className="ml-2 text-xs text-text-secondary font-normal">
                            ({group.paths.length} image{group.paths.length > 1 ? "s" : ""})
                          </span>
                        </span>
                        {!hasDecision && (
                          <span className="text-[10px] font-medium text-[#F59E0B]">Action requise</span>
                        )}
                      </div>

                      {/* Thumbnails */}
                      <div className="flex gap-2 overflow-x-auto no-scrollbar">
                        {group.paths.slice(0, 5).map((path, pi) => (
                          <div key={`${group.colorRef}-${pi}`} className="shrink-0 h-14 w-14 rounded-lg overflow-hidden border border-border bg-bg-secondary">
                            <img
                              src={path.endsWith(".webp") ? path.replace(/\.webp$/, "_thumb.webp") : path}
                              alt={`${group.colorName} ${pi + 1}`}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ))}
                        {group.paths.length > 5 && (
                          <div className="shrink-0 h-14 w-14 rounded-lg border border-border bg-bg-secondary flex items-center justify-center text-xs text-text-secondary">
                            +{group.paths.length - 5}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setOrphanAction(group.colorRef, "reassign")}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${decision?.action === "reassign" ? "bg-text-primary text-text-inverse" : "bg-bg-secondary text-text-secondary hover:bg-border"}`}>
                          Réattribuer
                        </button>
                        <button type="button" onClick={() => setOrphanAction(group.colorRef, "delete")}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${decision?.action === "delete" ? "bg-[#EF4444] text-white" : "bg-bg-secondary text-text-secondary hover:bg-[#EF4444]/10 hover:text-[#EF4444]"}`}>
                          Supprimer
                        </button>
                      </div>

                      {/* Target color select */}
                      {decision?.action === "reassign" && variantColorOptions.length > 0 && (
                        <CustomSelect
                          value={decision.targetColorRef}
                          onChange={(val) => setOrphanTarget(group.colorRef, val)}
                          options={variantColorOptions}
                          placeholder="Attribuer à…"
                          size="sm"
                          aria-label="Couleur cible"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Error */}
            {error && <p className="text-sm text-[#EF4444]">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4 shrink-0">
            <button onClick={onClose} className="btn-secondary min-w-[140px]" disabled={saving}>Annuler</button>
            <button onClick={handleSave} className="btn-primary min-w-[140px]" disabled={saving || hasUnresolvedOrphans}>
              {saving ? "Enregistrement…" : hasUnresolvedOrphans ? "Résoudre les images orphelines" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>

      {/* QuickCreate Modal */}
      {quickCreateType && (
        <QuickCreateModal
          type={quickCreateType}
          open={!!quickCreateType}
          onClose={() => { setQuickCreateType(null); setQuickCreateForIdx(null); }}
          onCreated={(item) => {
            if (quickCreateType === "color") {
              const newColor: ColorOption = { id: item.id, name: item.name, hex: item.hex ?? null, patternImage: null };
              setColorOptions((prev) => prev.some((c) => c.id === item.id) ? prev : [...prev, newColor].sort((a, b) => a.name.localeCompare(b.name)));
              // Add color directly to ALL variants in the same group (can't use toggleColor — colorOptions state not yet updated)
              if (quickCreateForIdx !== null) {
                const idx = quickCreateForIdx;
                setVariants((prev) => {
                  const targetKey = variantFullKey(prev[idx]);
                  const updated = [...prev];
                  for (let j = 0; j < updated.length; j++) {
                    if (variantFullKey(updated[j]) === targetKey) {
                      const v = { ...updated[j] };
                      const subColors = [...(v.subColors ?? [])];
                      if (v.colorId !== newColor.id && !subColors.some((sc) => sc.colorId === newColor.id)) {
                        v.subColors = [...subColors, { colorId: newColor.id, colorName: newColor.name, hex: newColor.hex, patternImage: newColor.patternImage }];
                        updated[j] = v;
                      }
                    }
                  }
                  return updated;
                });
              }
            }
            setQuickCreateType(null);
            setQuickCreateForIdx(null);
          }}
        />
      )}
    </>
  );
}

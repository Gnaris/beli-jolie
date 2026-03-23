"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { StagedProductFull, StagedImageGroup } from "./PfsProductDetailModal";
import ColorSwatch from "@/components/ui/ColorSwatch";

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

interface PfsEditImagesModalProps {
  product: StagedProductFull;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: StagedProductFull) => void;
}

interface ColorInfo {
  hex: string | null;
  patternImage: string | null;
}

/** Full color composition for display (main + sub-colors) */
interface FullColorComposition {
  label: string;
  mainHex: string | null;
  mainPatternImage: string | null;
  subColors?: { hex?: string | null; patternImage?: string | null }[];
}

/** Internal representation: fixed-length slots (null = empty position) */
interface SlotGroup {
  colorRef: string;
  colorName: string;
  colorId: string;
  slots: (string | null)[]; // always MAX_SLOTS length
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getThumbSrc(path: string): string {
  if (!path) return "";
  if (path.endsWith(".webp")) return path.replace(/\.webp$/, "_thumb.webp");
  return path;
}

function getLargeSrc(path: string): string {
  if (!path) return "";
  return path
    .replace(/_thumb\.webp$/, ".webp")
    .replace(/_md\.webp$/, ".webp");
}

const MAX_SLOTS = 5;

/** Convert StagedImageGroup[] → SlotGroup[] (paths fill slots left-to-right, pad with null) */
function toSlotGroups(imageGroups: StagedImageGroup[]): SlotGroup[] {
  return imageGroups.map((g) => {
    const slots: (string | null)[] = Array.from({ length: Math.max(MAX_SLOTS, g.paths.length) }, (_, i) =>
      i < g.paths.length ? g.paths[i] : null
    );
    return { colorRef: g.colorRef, colorName: g.colorName, colorId: g.colorId, slots };
  });
}

/** Convert SlotGroup[] → StagedImageGroup[] (compact: remove nulls, skip empty groups) */
function toImageGroups(slotGroups: SlotGroup[]): StagedImageGroup[] {
  return slotGroups
    .map((sg) => ({
      colorRef: sg.colorRef,
      colorName: sg.colorName,
      colorId: sg.colorId,
      paths: sg.slots.filter((s): s is string => s !== null),
    }))
    .filter((g) => g.paths.length > 0);
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

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="15" cy="19" r="1.5" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Image Zoom Overlay
// ─────────────────────────────────────────────

function ImageZoom({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Zoom image"
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        autoFocus
        className="absolute top-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Fermer le zoom"
      >
        <XIcon className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PfsEditImagesModal({
  product,
  open,
  onClose,
  onSaved,
}: PfsEditImagesModalProps) {
  // State uses SlotGroup[] (fixed-length slots with nulls for empty positions)
  const [groups, setGroups] = useState<SlotGroup[]>(() =>
    toSlotGroups(product.imagesByColor)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  // Drag state
  const dragGroupRef = useRef<number | null>(null);
  const dragSlotRef = useRef<number | null>(null);
  const [dragOverState, setDragOverState] = useState<{ groupIdx: number; slotIdx: number } | null>(null);

  // Color info from DB
  const [colorMap, setColorMap] = useState<Map<string, ColorInfo>>(new Map());

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch("/api/admin/pfs-sync/entities");
        if (res.ok) {
          const data = await res.json();
          const map = new Map<string, ColorInfo>();
          for (const c of data.colors || []) {
            map.set(c.id, { hex: c.hex, patternImage: c.patternImage });
          }
          setColorMap(map);
        }
      } catch {
        // silently fail
      }
    })();
  }, [open]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setGroups(toSlotGroups(product.imagesByColor));
      setError(null);
      setZoomSrc(null);
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product.id]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !zoomSrc) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, zoomSrc, onClose]);

  // Total image count (non-null slots)
  const totalImages = groups.reduce((sum, g) => sum + g.slots.filter(Boolean).length, 0);

  // ── Drag & Drop: slot-based swap ──

  const handleDragStart = useCallback((groupIdx: number, slotIdx: number) => {
    dragGroupRef.current = groupIdx;
    dragSlotRef.current = slotIdx;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, groupIdx: number, slotIdx: number) => {
      e.preventDefault();
      setDragOverState({ groupIdx, slotIdx });
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverState(null);
  }, []);

  const handleDrop = useCallback(
    (targetGroupIdx: number, targetSlotIdx: number) => {
      const fromGroup = dragGroupRef.current;
      const fromSlot = dragSlotRef.current;
      if (fromGroup === null || fromSlot === null) {
        dragGroupRef.current = null;
        dragSlotRef.current = null;
        setDragOverState(null);
        return;
      }

      // Same slot same group — no-op
      if (fromGroup === targetGroupIdx && fromSlot === targetSlotIdx) {
        dragGroupRef.current = null;
        dragSlotRef.current = null;
        setDragOverState(null);
        return;
      }

      setGroups((prev) => {
        const next = prev.map((g) => ({ ...g, slots: [...g.slots] }));
        const sourceSlots = next[fromGroup].slots;
        const targetSlots = next[targetGroupIdx].slots;

        // Get the image being moved
        const movedImage = sourceSlots[fromSlot];
        if (!movedImage) return prev; // nothing to move

        // Clear source slot
        sourceSlots[fromSlot] = null;

        // Swap: if target slot has an image, move it to the source slot
        const targetImage = targetSlots[targetSlotIdx];
        if (targetImage) {
          sourceSlots[fromSlot] = targetImage;
        }

        // Place moved image at target slot
        targetSlots[targetSlotIdx] = movedImage;

        return next;
      });

      dragGroupRef.current = null;
      dragSlotRef.current = null;
      setDragOverState(null);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    dragGroupRef.current = null;
    dragSlotRef.current = null;
    setDragOverState(null);
  }, []);

  // ── Delete image ──

  const handleDelete = useCallback((groupIdx: number, slotIdx: number) => {
    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, slots: [...g.slots] }));
      next[groupIdx].slots[slotIdx] = null;
      return next;
    });
  }, []);

  // ── Save (compact slots → paths) ──

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const imagesByColor = toImageGroups(groups);

      const res = await fetch(`/api/admin/pfs-sync/staged/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagesByColor }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }

      const { product: updated } = await res.json();
      const parsed: StagedProductFull = {
        ...product,
        ...updated,
        variants:
          typeof updated.variants === "string"
            ? JSON.parse(updated.variants)
            : updated.variants ?? product.variants,
        compositions:
          typeof updated.compositions === "string"
            ? JSON.parse(updated.compositions)
            : updated.compositions ?? product.compositions,
        translations:
          typeof updated.translations === "string"
            ? JSON.parse(updated.translations)
            : updated.translations ?? product.translations,
        imagesByColor:
          typeof updated.imagesByColor === "string"
            ? JSON.parse(updated.imagesByColor)
            : updated.imagesByColor ?? product.imagesByColor,
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

  // Resolve FULL color composition for a group
  const getFullComposition = (group: SlotGroup): FullColorComposition => {
    const variant = product.variants.find((v) => v.colorRef === group.colorRef);
    const mainInfo = group.colorId ? colorMap.get(group.colorId) : null;
    const mainHex = mainInfo?.hex ?? variant?.colorHex ?? null;
    const mainPatternImage = mainInfo?.patternImage ?? variant?.colorPatternImage ?? null;

    const names: string[] = [group.colorName];
    const subColors: { hex?: string | null; patternImage?: string | null }[] = [];

    if (variant?.subColors) {
      for (const sc of variant.subColors) {
        names.push(sc.colorName);
        const scInfo = sc.colorId ? colorMap.get(sc.colorId) : null;
        subColors.push({
          hex: scInfo?.hex ?? sc.hex ?? null,
          patternImage: scInfo?.patternImage ?? sc.patternImage ?? null,
        });
      }
    }

    return {
      label: names.join(", "),
      mainHex,
      mainPatternImage,
      subColors: subColors.length > 0 ? subColors : undefined,
    };
  };

  return (
    <>
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Images par couleur"
          className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-bg-primary shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
            <div>
              <h3 className="text-base font-semibold text-text-primary font-[family-name:var(--font-poppins)]">
                Images par couleur
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">
                {totalImages} photo{totalImages !== 1 ? "s" : ""} — partag{totalImages !== 1 ? "\u00E9es" : "\u00E9e"} entre toutes les variantes de la m{"\u00EA"}me couleur
              </p>
            </div>
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
            {groups.length === 0 ? (
              <p className="text-sm text-text-secondary py-8 text-center">
                Aucune image
              </p>
            ) : (
              groups.map((group, groupIdx) => {
                const composition = getFullComposition(group);
                const imageCount = group.slots.filter(Boolean).length;

                return (
                  <div
                    key={group.colorRef}
                    className="rounded-xl border border-border overflow-hidden"
                  >
                    {/* Color header */}
                    <div className="flex items-center gap-2.5 px-4 py-3 bg-bg-secondary border-b border-border">
                      <ColorSwatch
                        hex={composition.mainHex}
                        patternImage={composition.mainPatternImage}
                        subColors={composition.subColors}
                        size={18}
                        rounded="full"
                        border
                      />
                      <span className="text-sm font-semibold text-text-primary">
                        {composition.label}
                      </span>
                      <span className="text-xs text-text-secondary">
                        ({imageCount}/{group.slots.length})
                      </span>
                    </div>

                    {/* Slots grid */}
                    <div className="p-4">
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                        {group.slots.map((path, slotIdx) => {
                          const isDragOver =
                            dragOverState?.groupIdx === groupIdx &&
                            dragOverState?.slotIdx === slotIdx;

                          if (path) {
                            // Filled slot
                            return (
                              <div
                                key={`${group.colorRef}-${slotIdx}`}
                                draggable
                                onDragStart={() => handleDragStart(groupIdx, slotIdx)}
                                onDragOver={(e) => handleDragOver(e, groupIdx, slotIdx)}
                                onDragLeave={handleDragLeave}
                                onDrop={() => handleDrop(groupIdx, slotIdx)}
                                onDragEnd={handleDragEnd}
                                className={`group/img relative aspect-square rounded-xl border-2 overflow-hidden transition-all cursor-grab active:cursor-grabbing ${
                                  isDragOver
                                    ? "border-text-primary ring-2 ring-text-primary/20 scale-[1.03]"
                                    : "border-border hover:border-text-secondary"
                                }`}
                              >
                                {/* Drag handle */}
                                <div className="absolute top-1.5 left-1.5 z-10 hidden md:flex h-9 w-9 items-center justify-center rounded-lg bg-bg-primary/80 text-text-secondary opacity-0 backdrop-blur-sm transition-opacity group-hover/img:opacity-100">
                                  <GripIcon className="h-4 w-4" />
                                </div>

                                {/* Position badge */}
                                <span className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-bg-primary/80 text-[10px] font-semibold text-text-primary backdrop-blur-sm">
                                  {slotIdx + 1}
                                </span>

                                {/* Delete button */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDelete(groupIdx, slotIdx); }}
                                  className="absolute bottom-1.5 right-1.5 z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-[#EF4444]/90 text-white opacity-100 md:opacity-0 transition-opacity md:group-hover/img:opacity-100 hover:bg-[#EF4444]"
                                  aria-label={`Supprimer l'image ${slotIdx + 1}`}
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>

                                {/* Image (click to zoom) */}
                                <button
                                  onClick={() => setZoomSrc(getLargeSrc(path))}
                                  className="block h-full w-full"
                                  aria-label={`Zoom image ${slotIdx + 1}`}
                                >
                                  <img
                                    src={getThumbSrc(path)}
                                    alt={`${group.colorName} ${slotIdx + 1}`}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                </button>
                              </div>
                            );
                          }

                          // Empty slot — accepts drops
                          return (
                            <div
                              key={`${group.colorRef}-empty-${slotIdx}`}
                              onDragOver={(e) => handleDragOver(e, groupIdx, slotIdx)}
                              onDragLeave={handleDragLeave}
                              onDrop={() => handleDrop(groupIdx, slotIdx)}
                              className={`aspect-square rounded-xl border-2 border-dashed bg-bg-secondary flex items-center justify-center transition-all ${
                                isDragOver
                                  ? "border-text-primary bg-text-primary/5 scale-[1.03]"
                                  : "border-border"
                              }`}
                            >
                              <span className="text-lg font-medium text-text-secondary/40">
                                {slotIdx + 1}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Help text */}
                      {imageCount > 0 && (
                        <p className="text-[11px] text-text-secondary mt-3">
                          Glissez pour r{"\u00E9"}ordonner ou d{"\u00E9"}placer vers une autre couleur
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Error */}
            {error && (
              <p className="text-sm text-[#EF4444]">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4 shrink-0">
            <button onClick={onClose} className="btn-secondary flex-1 sm:flex-none sm:min-w-[140px]" disabled={saving}>
              Annuler
            </button>
            <button
              onClick={handleSave}
              className="btn-primary flex-1 sm:flex-none sm:min-w-[140px]"
              disabled={saving}
            >
              {saving ? "Enregistrement\u2026" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>

      {/* Image zoom overlay */}
      {zoomSrc && (
        <ImageZoom
          src={zoomSrc}
          alt={product.name}
          onClose={() => setZoomSrc(null)}
        />
      )}
    </>
  );
}

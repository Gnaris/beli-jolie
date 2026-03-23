"use client";

import { useState, useEffect, useCallback, useMemo, useRef, DragEvent } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { StagedProductFull } from "./PfsProductDetailModal";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ImageReplacement {
  colorId: string;
  position: number;
  pfsImagePath: string;
  replacedImageId?: string;
}

export interface ImageModifications {
  replacements: ImageReplacement[];
  deletions: string[]; // existing image IDs to delete
  reorders: Array<{ imageId: string; newOrder: number }>;
}

interface AppSlot {
  imageId?: string;
  path?: string;
  isPfs?: boolean; // true = PFS replacement image (don't apply getThumbSrc)
}

interface AppColorGroup {
  colorId: string;
  colorName: string;
  colorHex: string | null;
  slots: AppSlot[]; // always MAX_SLOTS length
}

interface PfsColorGroup {
  colorRef: string;
  colorName: string;
  colorHex?: string | null;
  paths: string[];
}

interface PairedRow {
  key: string;
  colorName: string;
  colorHex: string | null;
  app: AppColorGroup | null;
  pfs: PfsColorGroup | null;
}

type DragSource =
  | { type: "pfs"; path: string; colorRef: string; pos: number }
  | { type: "app"; colorId: string; pos: number; slot: AppSlot };

interface PfsImageCompareModalProps {
  product: StagedProductFull;
  open: boolean;
  onClose: () => void;
  onSaved: (modifications: ImageModifications) => void;
}

// ─────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────

const MAX_SLOTS = 5;

function isExternal(p: string): boolean {
  return p.startsWith("http");
}

function displaySrc(p: string, isPfs?: boolean): string {
  if (!p) return "";
  if (isPfs || isExternal(p)) return p;
  if (p.endsWith(".webp")) return p.replace(/\.webp$/, "_thumb.webp");
  return p;
}

function normalizeColor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
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

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ZoomInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="5" r="1" /><circle cx="15" cy="5" r="1" />
      <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="19" r="1" /><circle cx="15" cy="19" r="1" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function PfsImageCompareModal({
  product,
  open,
  onClose,
  onSaved,
}: PfsImageCompareModalProps) {
  const { confirm } = useConfirm();

  // ── State ──
  const [appGroups, setAppGroups] = useState<AppColorGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modifications, setModifications] = useState<ImageModifications>({
    replacements: [],
    deletions: [],
    reorders: [],
  });
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const dragCounters = useRef<Record<string, number>>({});

  // ── Fetch existing product images ──
  const fetchExisting = useCallback(async () => {
    if (!product.existingProductId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/pfs-sync/staged/${product.id}/compare-images`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }
      const { existingImages } = await res.json();

      // Convert API response to AppColorGroup with fixed-size slots
      const groups: AppColorGroup[] = (
        existingImages as Array<{
          colorId: string;
          colorName: string;
          colorHex: string | null;
          images: Array<{ id: string; path: string; order: number }>;
        }>
      ).map((g) => {
        const slots: AppSlot[] = Array.from({ length: MAX_SLOTS }, (_, i) => {
          const img = g.images.find((im) => im.order === i);
          return img ? { imageId: img.id, path: img.path } : {};
        });
        return {
          colorId: g.colorId,
          colorName: g.colorName,
          colorHex: g.colorHex,
          slots,
        };
      });

      setAppGroups(groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [product.id, product.existingProductId]);

  useEffect(() => {
    if (open) {
      fetchExisting();
      setModifications({ replacements: [], deletions: [], reorders: [] });
      setDragSource(null);
      setDragOverSlot(null);
      setZoomSrc(null);
      dragCounters.current = {};
    }
  }, [open, fetchExisting]);

  // ── Escape key (for modal + zoom) ──
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (zoomSrc) {
          setZoomSrc(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, zoomSrc, onClose]);

  // ── Paired color rows (app ↔ PFS alignment) ──
  const pairedRows = useMemo((): PairedRow[] => {
    const rows: PairedRow[] = [];
    const usedPfsIdx = new Set<number>();

    // Match app groups to PFS groups by normalized color name
    for (const appGroup of appGroups) {
      const pfsIdx = product.imagesByColor.findIndex(
        (p, i) =>
          !usedPfsIdx.has(i) &&
          normalizeColor(p.colorName) === normalizeColor(appGroup.colorName)
      );

      if (pfsIdx >= 0) {
        usedPfsIdx.add(pfsIdx);
        rows.push({
          key: appGroup.colorId,
          colorName: appGroup.colorName,
          colorHex: appGroup.colorHex,
          app: appGroup,
          pfs: product.imagesByColor[pfsIdx],
        });
      } else {
        rows.push({
          key: appGroup.colorId,
          colorName: appGroup.colorName,
          colorHex: appGroup.colorHex,
          app: appGroup,
          pfs: null,
        });
      }
    }

    // Add unmatched PFS-only groups
    product.imagesByColor.forEach((pfs, i) => {
      if (!usedPfsIdx.has(i)) {
        rows.push({
          key: `pfs-${pfs.colorRef}`,
          colorName: pfs.colorName,
          colorHex: pfs.colorHex ?? null,
          app: null,
          pfs,
        });
      }
    });

    return rows;
  }, [appGroups, product.imagesByColor]);

  // ─────────────────────────────────────────
  // Drag & Drop handlers
  // ─────────────────────────────────────────

  // PFS image drag start
  const onPfsDragStart = (
    e: DragEvent,
    path: string,
    colorRef: string,
    pos: number
  ) => {
    setDragSource({ type: "pfs", path, colorRef, pos });
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", "pfs");
  };

  // App image drag start (for reorder)
  const onAppDragStart = (
    e: DragEvent,
    colorId: string,
    pos: number,
    slot: AppSlot
  ) => {
    setDragSource({ type: "app", colorId, pos, slot });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "app");
  };

  const onDragEnd = () => {
    setDragSource(null);
    setDragOverSlot(null);
    dragCounters.current = {};
  };

  // Use counter-based approach to fix dragLeave flickering
  const onSlotDragEnter = (e: DragEvent, slotKey: string) => {
    e.preventDefault();
    dragCounters.current[slotKey] = (dragCounters.current[slotKey] ?? 0) + 1;
    setDragOverSlot(slotKey);
  };

  const onSlotDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = dragSource?.type === "pfs" ? "copy" : "move";
  };

  const onSlotDragLeave = (_e: DragEvent, slotKey: string) => {
    dragCounters.current[slotKey] = (dragCounters.current[slotKey] ?? 1) - 1;
    if (dragCounters.current[slotKey] <= 0) {
      dragCounters.current[slotKey] = 0;
      if (dragOverSlot === slotKey) setDragOverSlot(null);
    }
  };

  const onSlotDrop = async (
    e: DragEvent,
    targetColorId: string,
    targetPos: number
  ) => {
    e.preventDefault();
    const slotKey = `${targetColorId}-${targetPos}`;
    dragCounters.current[slotKey] = 0;
    setDragOverSlot(null);

    if (!dragSource) return;

    if (dragSource.type === "pfs") {
      // ── PFS → App: Replace or Add ──
      const targetGroup = appGroups.find((g) => g.colorId === targetColorId);
      const existingSlot = targetGroup?.slots[targetPos];

      if (existingSlot?.path && !existingSlot.isPfs) {
        const ok = await confirm({
          type: "danger",
          title: "Remplacer l'image ?",
          message: `L'image en position ${targetPos + 1} sera remplacée par l'image PFS.`,
          confirmLabel: "Remplacer",
          cancelLabel: "Annuler",
        });
        if (!ok) {
          setDragSource(null);
          return;
        }
      }

      // Update modifications
      setModifications((prev) => ({
        ...prev,
        replacements: [
          ...prev.replacements.filter(
            (r) =>
              !(r.colorId === targetColorId && r.position === targetPos)
          ),
          {
            colorId: targetColorId,
            position: targetPos,
            pfsImagePath: dragSource.path,
            replacedImageId: existingSlot?.imageId,
          },
        ],
      }));

      // Update visual state
      setAppGroups((prev) =>
        prev.map((g) => {
          if (g.colorId !== targetColorId) return g;
          const newSlots = [...g.slots];
          newSlots[targetPos] = {
            imageId: existingSlot?.imageId,
            path: dragSource.path,
            isPfs: true,
          };
          return { ...g, slots: newSlots };
        })
      );
    } else if (
      dragSource.type === "app" &&
      dragSource.colorId === targetColorId
    ) {
      // ── App → App: Swap positions (reorder) ──
      const fromPos = dragSource.pos;
      if (fromPos === targetPos) {
        setDragSource(null);
        return;
      }

      // Capture current state before swap for reorder tracking
      const group = appGroups.find((g) => g.colorId === targetColorId);
      if (group) {
        const fromSlot = group.slots[fromPos];
        const toSlot = group.slots[targetPos];

        setModifications((prev) => {
          let reorders = [...prev.reorders];
          if (fromSlot.imageId && !fromSlot.isPfs) {
            reorders = reorders.filter((r) => r.imageId !== fromSlot.imageId);
            reorders.push({ imageId: fromSlot.imageId, newOrder: targetPos });
          }
          if (toSlot.imageId && !toSlot.isPfs) {
            reorders = reorders.filter((r) => r.imageId !== toSlot.imageId);
            reorders.push({ imageId: toSlot.imageId, newOrder: fromPos });
          }
          // Also update replacements positions if PFS images involved
          const replacements = prev.replacements.map((r) => {
            if (r.colorId !== targetColorId) return r;
            if (r.position === fromPos) return { ...r, position: targetPos };
            if (r.position === targetPos) return { ...r, position: fromPos };
            return r;
          });
          return { ...prev, reorders, replacements };
        });
      }

      // Swap visual state
      setAppGroups((prev) =>
        prev.map((g) => {
          if (g.colorId !== targetColorId) return g;
          const newSlots = [...g.slots];
          const temp = newSlots[fromPos];
          newSlots[fromPos] = newSlots[targetPos];
          newSlots[targetPos] = temp;
          return { ...g, slots: newSlots };
        })
      );
    }

    setDragSource(null);
  };

  // ── Delete handler ──
  const handleDelete = async (colorId: string, pos: number) => {
    const group = appGroups.find((g) => g.colorId === colorId);
    const slot = group?.slots[pos];
    if (!slot?.path) return;

    const ok = await confirm({
      type: "danger",
      title: "Supprimer l'image ?",
      message: `L'image en position ${pos + 1} sera supprimée.`,
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    if (slot.imageId && !slot.isPfs) {
      // Track deletion of original image (deduplicate to guard against double-click)
      setModifications((prev) => ({
        ...prev,
        deletions: prev.deletions.includes(slot.imageId!)
          ? prev.deletions
          : [...prev.deletions, slot.imageId!],
        // Also remove any reorder for this image
        reorders: prev.reorders.filter((r) => r.imageId !== slot.imageId),
      }));
    } else if (slot.isPfs) {
      // Remove from replacements (it was a PFS replacement)
      setModifications((prev) => ({
        ...prev,
        replacements: prev.replacements.filter(
          (r) => !(r.colorId === colorId && r.position === pos)
        ),
      }));
    }

    setAppGroups((prev) =>
      prev.map((g) => {
        if (g.colorId !== colorId) return g;
        const newSlots = [...g.slots];
        newSlots[pos] = {};
        return { ...g, slots: newSlots };
      })
    );
  };

  // ── Save ──
  const handleSave = () => {
    onSaved(modifications);
    onClose();
  };

  // ── Count modifications ──
  const modCount =
    modifications.replacements.length +
    modifications.deletions.length +
    modifications.reorders.length;

  if (!open) return null;

  // Check if we're dragging from PFS or App for visual cues
  const isDraggingPfs = dragSource?.type === "pfs";
  const isDraggingApp = dragSource?.type === "app";
  const draggingAppColorId =
    dragSource?.type === "app" ? dragSource.colorId : null;

  return (
    <>
      {/* ── Main overlay ── */}
      <div
        className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 sm:p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-images-title"
      >
        <div
          className="relative flex h-[95vh] sm:h-[90vh] w-full max-w-7xl flex-col rounded-2xl bg-bg-primary shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between border-b border-border px-4 sm:px-6 py-4">
            <div className="min-w-0">
              <h2 id="compare-images-title" className="text-lg font-semibold text-text-primary font-[family-name:var(--font-poppins)]">
                Comparaison des images
              </h2>
              <p className="text-sm text-text-secondary mt-0.5 truncate">
                {product.name}{" "}
                <span className="text-xs opacity-60">
                  ({product.reference})
                </span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bg-secondary text-text-secondary transition-colors hover:bg-border hover:text-text-primary focus-visible:ring-2 focus-visible:ring-[#3B82F6] focus-visible:ring-offset-1"
              aria-label="Fermer la comparaison d'images"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          {/* ── Legend bar ── */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-b border-border bg-bg-secondary px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#3B82F6]" />
              <span className="text-xs text-text-secondary font-medium">
                Notre produit
              </span>
            </div>
            <span className="text-xs text-text-secondary">
              Glissez les images PFS → emplacements Application &bull; Réordonnez par glisser-déposer
            </span>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#F59E0B]" />
              <span className="text-xs text-text-secondary font-medium">
                PFS
              </span>
            </div>
          </div>

          {/* ── Content: paired rows ── */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-text-primary" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <p className="text-sm text-[#EF4444] mb-3">{error}</p>
                <button
                  onClick={fetchExisting}
                  className="btn-secondary text-sm"
                >
                  Réessayer
                </button>
              </div>
            ) : pairedRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
                <ImageIcon className="h-10 w-10 mb-2" />
                <span className="text-sm">Aucune image à comparer</span>
              </div>
            ) : (
              pairedRows.map((row) => (
                <div
                  key={row.key}
                  className="rounded-xl border border-border bg-bg-secondary/30 p-4"
                >
                  {/* ── Color header ── */}
                  <div className="flex items-center gap-2 mb-3">
                    {row.colorHex && (
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-border shrink-0"
                        style={{ backgroundColor: row.colorHex }}
                      />
                    )}
                    <span className="text-sm font-semibold text-text-primary font-[family-name:var(--font-poppins)]">
                      {row.colorName}
                    </span>
                    {row.app && row.pfs && (
                      <span className="badge badge-success text-[10px]">
                        Correspondance
                      </span>
                    )}
                    {row.app && !row.pfs && (
                      <span className="badge badge-info text-[10px]">
                        Application uniquement
                      </span>
                    )}
                    {!row.app && row.pfs && (
                      <span className="badge badge-warning text-[10px]">
                        PFS uniquement
                      </span>
                    )}
                  </div>

                  {/* ── Two columns ── */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* ── LEFT: Application (notre produit) ── */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#3B82F6] bg-[#3B82F6]/10 rounded px-2 py-1 mb-2 text-center">
                        Application
                      </div>
                      {row.app ? (
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                          {row.app.slots.map((slot, pos) => {
                            const slotKey = `${row.app!.colorId}-${pos}`;
                            const isOver = dragOverSlot === slotKey;
                            const hasImage = !!slot.path;
                            const isFromPfs = !!slot.isPfs;
                            // Accept drops from PFS or from same color group
                            const canDrop =
                              isDraggingPfs ||
                              (isDraggingApp &&
                                draggingAppColorId === row.app!.colorId);

                            return (
                              <div
                                key={slotKey}
                                className="relative group"
                              >
                                <div className="text-[11px] text-text-secondary text-center mb-1">
                                  {pos + 1}
                                </div>
                                <div
                                  draggable={hasImage}
                                  onDragStart={
                                    hasImage
                                      ? (e) =>
                                          onAppDragStart(
                                            e,
                                            row.app!.colorId,
                                            pos,
                                            slot
                                          )
                                      : undefined
                                  }
                                  onDragEnter={
                                    canDrop
                                      ? (e) => onSlotDragEnter(e, slotKey)
                                      : undefined
                                  }
                                  onDragOver={
                                    canDrop ? onSlotDragOver : undefined
                                  }
                                  onDragLeave={
                                    canDrop
                                      ? (e) => onSlotDragLeave(e, slotKey)
                                      : undefined
                                  }
                                  onDrop={
                                    canDrop
                                      ? (e) =>
                                          onSlotDrop(
                                            e,
                                            row.app!.colorId,
                                            pos
                                          )
                                      : undefined
                                  }
                                  onDragEnd={onDragEnd}
                                  className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                                    isOver
                                      ? isDraggingPfs
                                        ? "border-[#F59E0B] bg-[#F59E0B]/10 scale-105 shadow-lg"
                                        : "border-[#3B82F6] bg-[#3B82F6]/10 scale-105 shadow-lg"
                                      : isFromPfs
                                        ? "border-[#22C55E] bg-[#22C55E]/5"
                                        : hasImage
                                          ? "border-border bg-bg-secondary"
                                          : "border-dashed border-border bg-bg-secondary"
                                  } ${hasImage ? "cursor-grab active:cursor-grabbing" : ""}`}
                                >
                                  {hasImage ? (
                                    <img
                                      src={displaySrc(slot.path!, slot.isPfs)}
                                      alt={`${row.colorName} ${pos + 1}`}
                                      className="h-full w-full object-cover pointer-events-none"
                                      loading="lazy"
                                      draggable={false}
                                    />
                                  ) : (
                                    <div className="h-full w-full flex items-center justify-center">
                                      <span className="text-[11px] text-text-secondary/60">
                                        vide
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* Overlay: zoom + delete — visible on hover (desktop) and always on touch */}
                                {hasImage && (
                                  <div className="absolute inset-0 mt-[18px] rounded-lg flex items-end justify-center gap-1.5 pb-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/40 to-transparent pointer-events-none">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setZoomSrc(slot.path!);
                                      }}
                                      className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-black shadow-sm transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[#3B82F6] focus-visible:ring-offset-1"
                                      aria-label={`Agrandir l'image ${pos + 1} – ${row.colorName}`}
                                    >
                                      <ZoomInIcon className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(row.app!.colorId, pos);
                                      }}
                                      className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-[#EF4444] text-white shadow-sm transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[#EF4444] focus-visible:ring-offset-1"
                                      aria-label={`Supprimer l'image ${pos + 1} – ${row.colorName}`}
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}

                                {/* PFS replacement badge */}
                                {isFromPfs && (
                                  <div className="absolute top-[14px] -start-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#22C55E] text-white">
                                    <CheckIcon className="h-2.5 w-2.5" />
                                  </div>
                                )}

                                {/* Grip indicator for draggable images */}
                                {hasImage && !isOver && (
                                  <div className="absolute top-[18px] start-0.5 hidden md:block opacity-0 group-hover:opacity-60 transition-opacity">
                                    <GripIcon className="h-3 w-3 text-text-secondary" />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center py-8 text-text-secondary rounded-lg border border-dashed border-border">
                          <span className="text-xs italic">
                            Aucune image pour cette couleur
                          </span>
                        </div>
                      )}
                    </div>

                    {/* ── RIGHT: PFS ── */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#D97706] bg-[#F59E0B]/10 rounded px-2 py-1 mb-2 text-center">
                        PFS
                      </div>
                      {row.pfs ? (
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                          {Array.from({ length: MAX_SLOTS }).map((_, pos) => {
                            const path = row.pfs!.paths[pos];
                            return (
                              <div
                                key={`pfs-${row.key}-${pos}`}
                                className="relative"
                              >
                                <div className="text-[11px] text-text-secondary text-center mb-1">
                                  {pos + 1}
                                </div>
                                {path ? (
                                  <div
                                    draggable
                                    onDragStart={(e) =>
                                      onPfsDragStart(
                                        e,
                                        path,
                                        row.pfs!.colorRef,
                                        pos
                                      )
                                    }
                                    onDragEnd={onDragEnd}
                                    className="aspect-square rounded-lg overflow-hidden border border-border bg-bg-secondary cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md hover:border-[#F59E0B]/50 group/pfs relative"
                                  >
                                    <img
                                      src={path}
                                      alt={`PFS ${row.colorName} ${pos + 1}`}
                                      className="h-full w-full object-cover pointer-events-none"
                                      loading="lazy"
                                      draggable={false}
                                    />
                                    {/* Zoom button — visible on touch, hover on desktop */}
                                    <div className="absolute inset-0 flex items-end justify-center pb-1.5 opacity-100 md:opacity-0 md:group-hover/pfs:opacity-100 transition-opacity bg-gradient-to-t from-black/40 to-transparent">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setZoomSrc(path);
                                        }}
                                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-black shadow-sm transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[#F59E0B] focus-visible:ring-offset-1"
                                        aria-label={`Agrandir l'image PFS ${pos + 1} – ${row.colorName}`}
                                      >
                                        <ZoomInIcon className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="aspect-square rounded-lg border border-dashed border-border bg-bg-secondary flex items-center justify-center">
                                    <span className="text-[11px] text-text-secondary/60">
                                      vide
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center py-8 text-text-secondary rounded-lg border border-dashed border-border">
                          <span className="text-xs italic">
                            Aucune image PFS
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border px-4 sm:px-6 py-3 sm:py-4">
            <div className="text-sm text-text-secondary text-center sm:text-left">
              {modCount > 0 ? (
                <span>
                  <span className="font-medium text-[#22C55E]">
                    {modCount}
                  </span>{" "}
                  modification{modCount > 1 ? "s" : ""} en attente
                  {modifications.replacements.length > 0 && (
                    <span className="ml-2 text-xs">
                      ({modifications.replacements.length} remplacement
                      {modifications.replacements.length > 1 ? "s" : ""})
                    </span>
                  )}
                  {modifications.deletions.length > 0 && (
                    <span className="ml-1 text-xs">
                      ({modifications.deletions.length} suppression
                      {modifications.deletions.length > 1 ? "s" : ""})
                    </span>
                  )}
                  {modifications.reorders.length > 0 && (
                    <span className="ml-1 text-xs">
                      ({modifications.reorders.length} réordonnancement
                      {modifications.reorders.length > 1 ? "s" : ""})
                    </span>
                  )}
                </span>
              ) : (
                <span className="hidden sm:inline">
                  Glissez des images PFS vers les emplacements Application
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                onClick={onClose}
                className="btn-secondary h-10 sm:h-9 min-w-[100px] flex-1 sm:flex-none"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={modCount === 0}
                className="btn-primary h-10 sm:h-9 min-w-[140px] flex-1 sm:flex-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckIcon className="h-4 w-4" />
                Valider ({modCount})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Zoom overlay ── */}
      {zoomSrc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setZoomSrc(null)}
        >
          <div className="relative max-h-[85vh] max-w-[85vw]">
            <img
              src={zoomSrc}
              alt="Zoom"
              className="max-h-[85vh] max-w-[85vw] object-contain rounded-lg"
            />
            <button
              onClick={() => setZoomSrc(null)}
              className="absolute -top-3 -end-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[#3B82F6] focus-visible:ring-offset-1"
              aria-label="Fermer le zoom"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

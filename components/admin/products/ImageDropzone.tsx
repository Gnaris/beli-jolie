"use client";

import { useRef, useState } from "react";

interface ImageDropzoneProps {
  colorIndex: number;
  groupKey: string;
  previews: string[];
  orders: number[];
  onAddAtPosition: (file: File, position: number) => void;
  onRemoveAtPosition: (position: number) => void;
  onSwapPositions: (fromPos: number, toPos: number) => void;
  onCrossColorDrop?: (sourceGroupKey: string, sourcePos: number, targetPos: number) => void;
  onConfirmReplace?: (position: number) => Promise<boolean>;
  uploading: boolean;
  uploadingPosition?: number | null;
}

const MAX_IMAGES = 5;

export default function ImageDropzone({
  colorIndex,
  groupKey,
  previews,
  orders,
  onAddAtPosition,
  onRemoveAtPosition,
  onSwapPositions,
  onCrossColorDrop,
  onConfirmReplace,
  uploading,
  uploadingPosition,
}: ImageDropzoneProps) {
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [draggedPos, setDraggedPos] = useState<number | null>(null);
  const [dragOverPos, setDragOverPos] = useState<number | null>(null);
  const [zoomedSrc, setZoomedSrc] = useState<string | null>(null);

  // Map position → array index
  function getImageAtPosition(pos: number): { src: string; arrayIndex: number } | null {
    const idx = orders.indexOf(pos);
    if (idx === -1 || !previews[idx]) return null;
    return { src: previews[idx], arrayIndex: idx };
  }

  // Check if position is occupied and ask for confirmation if needed
  async function confirmIfOccupied(pos: number): Promise<boolean> {
    const existing = getImageAtPosition(pos);
    if (!existing) return true; // empty slot, no confirm needed
    if (!onConfirmReplace) return true; // no confirm handler, proceed
    return onConfirmReplace(pos);
  }

  // File input handler for a specific position
  async function handleFileChange(pos: number, files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    const ok = await confirmIfOccupied(pos);
    if (ok) onAddAtPosition(file, pos);
  }

  // Drag & drop from OS
  async function handleSlotDrop(e: React.DragEvent, pos: number) {
    e.preventDefault();
    e.stopPropagation();

    // Internal drag (same color group — swap positions)
    if (draggedPos !== null) {
      if (draggedPos !== pos) onSwapPositions(draggedPos, pos);
      setDraggedPos(null);
      setDragOverPos(null);
      return;
    }

    // Cross-color drag (from another color group)
    const crossData = e.dataTransfer.getData("application/x-image-drag");
    if (crossData && onCrossColorDrop) {
      try {
        const { groupKey: srcGroupKey, pos: srcPos } = JSON.parse(crossData);
        if (srcGroupKey !== groupKey) {
          onCrossColorDrop(srcGroupKey, srcPos, pos);
          setDragOverPos(null);
          return;
        }
      } catch { /* ignore parse errors */ }
    }

    // External file drop
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = Array.from(files).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      const ok = await confirmIfOccupied(pos);
      if (ok) onAddAtPosition(file, pos);
    }
  }

  function handleSlotDragOver(e: React.DragEvent, pos: number) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPos(pos);
  }

  function handleSlotDragLeave() {
    setDragOverPos(null);
  }

  // Internal drag start (image reordering) — also supports cross-color
  function handleImgDragStart(e: React.DragEvent, pos: number) {
    e.stopPropagation();
    setDraggedPos(pos);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-image-drag", JSON.stringify({ groupKey, pos }));
  }

  function handleImgDragEnd() {
    setDraggedPos(null);
    setDragOverPos(null);
  }

  return (
    <>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: MAX_IMAGES }, (_, pos) => {
          const img = getImageAtPosition(pos);
          const isUploading = uploading && uploadingPosition === pos;
          const isDraggedFrom = draggedPos === pos;
          const isDragOver = dragOverPos === pos;

          return (
            <div
              key={pos}
              className={`relative aspect-square border-2 rounded-lg overflow-hidden transition-all ${
                isDragOver
                  ? "border-[#1A1A1A] bg-[#F7F7F8] scale-[1.02]"
                  : img
                    ? "border-[#E5E5E5] bg-white"
                    : "border-dashed border-[#D1D5DB] bg-[#FAFAFA] hover:border-[#9CA3AF] hover:bg-[#F7F7F8]"
              } ${isDraggedFrom ? "opacity-30 scale-95" : ""} ${
                isUploading ? "opacity-60 pointer-events-none" : ""
              }`}
              onDragOver={(e) => handleSlotDragOver(e, pos)}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, pos)}
            >
              {isUploading ? (
                /* Uploading state */
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <svg className="animate-spin w-5 h-5 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-[9px] text-[#9CA3AF] font-[family-name:var(--font-roboto)]">Upload...</span>
                </div>
              ) : img ? (
                /* Filled slot */
                <div className="group w-full h-full cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={(e) => handleImgDragStart(e, pos)}
                  onDragEnd={handleImgDragEnd}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.src}
                    alt={`Image position ${pos + 1}`}
                    draggable={false}
                    onClick={() => setZoomedSrc(img.src)}
                    className="w-full h-full object-cover cursor-zoom-in"
                  />
                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemoveAtPosition(pos); }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-30"
                    aria-label="Supprimer l'image"
                  >
                    ×
                  </button>
                  {/* Drag handle */}
                  <span className="absolute top-0.5 left-0.5 opacity-0 group-hover:opacity-70 transition-opacity z-30">
                    <svg className="w-3 h-3 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8-16a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                    </svg>
                  </span>
                  {/* Position badge */}
                  <span className="absolute bottom-0 left-0 bg-[#1A1A1A]/60 text-white text-[9px] px-1.5 py-0.5 select-none font-[family-name:var(--font-roboto)]">
                    {pos + 1}
                  </span>
                </div>
              ) : (
                /* Empty slot */
                <div
                  className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
                  onClick={() => fileInputRefs.current[pos]?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && fileInputRefs.current[pos]?.click()}
                >
                  <input
                    ref={(el) => { fileInputRefs.current[pos] = el; }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => { handleFileChange(pos, e.target.files); e.target.value = ""; }}
                    id={`image-slot-${colorIndex}-${pos}`}
                  />
                  <span className="text-lg font-bold text-[#D1D5DB] font-[family-name:var(--font-poppins)] leading-none">
                    {pos + 1}
                  </span>
                  <svg className="w-4 h-4 text-[#D1D5DB] mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-[#9CA3AF] mt-1.5 font-[family-name:var(--font-roboto)]">
        JPG, PNG, WEBP — max 3 Mo — glissez entre les positions pour réordonner ou vers une autre couleur pour déplacer
      </p>

      {/* ── Lightbox zoom ─────────────────────────────────────────────── */}
      {zoomedSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setZoomedSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt="Apercu"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain shadow-2xl"
            style={{ maxHeight: "90vh", maxWidth: "90vw" }}
          />
          <button
            type="button"
            onClick={() => setZoomedSrc(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-colors text-xl"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

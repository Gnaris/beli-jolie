"use client";

import { useRef, useState, useCallback } from "react";

interface ImageDropzoneProps {
  colorIndex: number;
  groupKey: string;
  previews: string[];
  orders: number[];
  onAddAtPosition: (file: File, position: number) => void;
  onRemoveAtPosition: (position: number) => void;
  onSwapPositions: (fromPos: number, toPos: number) => void;
  onCrossColorDrop?: (sourceGroupKey: string, sourcePos: number, targetPos: number) => void;
  uploading: boolean;
  uploadingPosition?: number | null;
  hasError?: boolean;
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
  uploading,
  uploadingPosition,
  hasError,
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

  // File input handler — position is auto-assigned by parent
  function handleFileChange(pos: number, files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    onAddAtPosition(file, pos);
  }

  // Drag & drop from OS
  function handleSlotDrop(e: React.DragEvent, pos: number) {
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

    // External file drop — position is auto-assigned by parent
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = Array.from(files).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      onAddAtPosition(file, pos);
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

  const handleDownloadAsJpg = useCallback((src: string, pos: number) => {
    const canvas = document.createElement("canvas");
    const imgEl = new Image();
    imgEl.crossOrigin = "anonymous";
    imgEl.onload = () => {
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Fill white background (JPG has no transparency)
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgEl, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `image-${pos + 1}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, "image/jpeg", 0.92);
    };
    imgEl.onerror = () => {
      // Fallback: direct download if canvas conversion fails (CORS)
      const a = document.createElement("a");
      a.href = src;
      a.download = `image-${pos + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    imgEl.src = src;
  }, []);

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
              className={`group relative aspect-square border-2 rounded-lg overflow-visible transition-all ${
                isDragOver
                  ? "border-bg-dark bg-bg-secondary scale-[1.02]"
                  : img
                    ? "border-border bg-bg-primary"
                    : hasError
                      ? "border-dashed border-[#EF4444] bg-red-50/50 hover:border-red-400 hover:bg-red-50"
                      : "border-dashed border-border-light bg-bg-secondary hover:border-text-muted hover:bg-bg-tertiary"
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
                  <svg className="animate-spin w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-[9px] text-text-muted font-body">Upload...</span>
                </div>
              ) : img ? (
                /* Filled slot */
                <div className="w-full h-full cursor-grab active:cursor-grabbing overflow-hidden rounded-lg"
                  draggable
                  onDragStart={(e) => handleImgDragStart(e, pos)}
                  onDragEnd={handleImgDragEnd}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.src}
                    alt={`Image position ${pos + 1}`}
                    draggable={false}
                    className="w-full h-full object-contain"
                  />
                  {/* Hover overlay with actions */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 z-20 rounded-lg">
                    {/* Zoom button */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setZoomedSrc(img.src); }}
                      className="w-8 h-8 bg-white/20 hover:bg-white/40 rounded-full flex items-center justify-center transition-colors"
                      aria-label="Voir en grand"
                      title="Voir en grand"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                    </button>
                    {/* Download button */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDownloadAsJpg(img.src, pos); }}
                      className="w-8 h-8 bg-white/20 hover:bg-white/40 rounded-full flex items-center justify-center transition-colors"
                      aria-label="Télécharger en JPG"
                      title="Télécharger en JPG"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                  </div>
                  {/* Drag handle */}
                  <span className="absolute top-1 left-1 bg-black/40 backdrop-blur-sm rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-30 cursor-grab active:cursor-grabbing">
                    <svg className="w-4 h-4 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8-16a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                    </svg>
                  </span>
                  {/* Position badge */}
                  <span className="absolute bottom-0 left-0 bg-bg-dark/60 text-text-inverse text-[9px] px-1.5 py-0.5 select-none font-body rounded-br-lg">
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
                  <span className="text-lg font-bold text-text-muted/50 font-heading leading-none">
                    {pos + 1}
                  </span>
                  <svg className="w-4 h-4 text-text-muted/50 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
              )}
              {/* Remove button — outside overflow-hidden wrapper so it's not clipped */}
              {img && !isUploading && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemoveAtPosition(pos); }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-30"
                  aria-label="Supprimer l'image"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-text-muted mt-1.5 font-body">
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
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-colors text-xl z-50"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

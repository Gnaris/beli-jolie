"use client";

import { useRef, useState } from "react";

interface ImageDropzoneProps {
  colorIndex: number;
  previews: string[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  uploading: boolean;
}

const MAX_IMAGES = 5;

export default function ImageDropzone({
  colorIndex,
  previews,
  onAdd,
  onRemove,
  onReorder,
  uploading,
}: ImageDropzoneProps) {
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const [dropZoneDragging, setDropZoneDragging] = useState(false);
  const [draggedIdx, setDraggedIdx]             = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx]           = useState<number | null>(null);
  const [zoomedSrc, setZoomedSrc]               = useState<string | null>(null);

  // ── Ajout de fichiers depuis l'OS ──────────────────────────────────────
  function handleFiles(files: FileList | null) {
    if (!files) return;
    const remaining = MAX_IMAGES - previews.length;
    if (remaining <= 0) return;
    const valid = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, remaining);
    if (valid.length > 0) onAdd(valid);
  }

  // Drop zone (ajout fichiers OS)
  function handleZoneDragOver(e: React.DragEvent) {
    // Si on fait glisser une image interne, ne pas activer la zone
    if (draggedIdx !== null) return;
    e.preventDefault();
    setDropZoneDragging(true);
  }
  function handleZoneDragLeave() { setDropZoneDragging(false); }
  function handleZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropZoneDragging(false);
    if (draggedIdx !== null) return; // Drag interne, ignoré ici
    handleFiles(e.dataTransfer.files);
  }

  // ── Drag & drop reorder des images ────────────────────────────────────
  function handleImgDragStart(e: React.DragEvent, idx: number) {
    e.stopPropagation();
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  }
  function handleImgDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIdx === null || draggedIdx === idx) return;
    setDragOverIdx(idx);
  }
  function handleImgDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIdx !== null && draggedIdx !== idx) {
      onReorder(draggedIdx, idx);
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  }
  function handleImgDragEnd() {
    setDraggedIdx(null);
    setDragOverIdx(null);
  }

  const canAdd = previews.length < MAX_IMAGES;

  return (
    <>
      <div className="space-y-3">
        {/* Grille des prévisualisations */}
        {previews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {previews.map((src, imgIdx) => (
              <div
                key={imgIdx}
                draggable
                onDragStart={(e) => handleImgDragStart(e, imgIdx)}
                onDragOver={(e)  => handleImgDragOver(e, imgIdx)}
                onDrop={(e)      => handleImgDrop(e, imgIdx)}
                onDragEnd={handleImgDragEnd}
                className={`relative group w-20 h-20 cursor-grab active:cursor-grabbing transition-all ${
                  draggedIdx === imgIdx  ? "opacity-30 scale-95" : ""
                } ${dragOverIdx === imgIdx ? "ring-2 ring-[#8B7355] ring-offset-1" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Image ${imgIdx + 1}`}
                  draggable={false}
                  onClick={() => setZoomedSrc(src)}
                  className="w-full h-full object-cover border border-[#D4CCBE] cursor-zoom-in"
                />
                {/* Supprimer */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemove(imgIdx); }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                  aria-label="Supprimer l'image"
                >
                  ×
                </button>
                {/* Badge ordre */}
                <span className="absolute bottom-0 left-0 bg-[#2C2418]/60 text-white text-[9px] px-1 select-none">
                  {imgIdx + 1}
                </span>
                {/* Icône drag */}
                <span className="absolute top-0 left-0 p-0.5 opacity-0 group-hover:opacity-70 transition-opacity">
                  <svg className="w-3 h-3 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8-16a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                  </svg>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Zone de drop (ajout fichiers OS) */}
        {canAdd && (
          <div
            onDragOver={handleZoneDragOver}
            onDragLeave={handleZoneDragLeave}
            onDrop={handleZoneDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
              dropZoneDragging
                ? "border-[#8B7355] bg-[#F7F3EC]"
                : "border-[#D4CCBE] hover:border-[#8B7355] bg-[#FDFAF6]"
            } ${uploading ? "opacity-60 pointer-events-none" : ""}`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
              id={`images-color-${colorIndex}`}
            />
            {uploading ? (
              <div className="flex items-center justify-center gap-2 text-[#8B7355]">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <span className="text-xs font-[family-name:var(--font-roboto)]">Upload en cours…</span>
              </div>
            ) : (
              <>
                <svg className="w-6 h-6 text-[#B8A48A] mx-auto mb-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-xs font-[family-name:var(--font-roboto)] text-[#6B5B45]">
                  Glissez ou cliquez pour ajouter
                </p>
                <p className="text-[10px] text-[#B8A48A] mt-0.5">
                  JPG, PNG, WEBP · max 3 Mo · {previews.length}/{MAX_IMAGES} — glissez les images pour réordonner
                </p>
              </>
            )}
          </div>
        )}

        {previews.length >= MAX_IMAGES && (
          <p className="text-xs text-[#B8A48A] font-[family-name:var(--font-roboto)]">
            Maximum de {MAX_IMAGES} images atteint.
          </p>
        )}
      </div>

      {/* ── Lightbox zoom ─────────────────────────────────────────────── */}
      {zoomedSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setZoomedSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt="Aperçu"
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

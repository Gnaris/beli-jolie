"use client";

import SmartImage from "@/components/ui/SmartImage";

export interface PendingFile {
  file: File;
  url: string;
}

interface Props {
  files: PendingFile[];
  onRemove: (index: number) => void;
}

/**
 * Vignettes des fichiers sélectionnés mais pas encore envoyés dans le chat.
 * Images : miniature via URL.createObjectURL. PDF : icône + nom raccourci.
 */
export default function ChatAttachmentPreview({ files, onRemove }: Props) {
  if (files.length === 0) return null;

  return (
    <div className="flex gap-2 mb-2 flex-wrap">
      {files.map((f, i) => {
        const isImage = f.file.type.startsWith("image/");
        return (
          <div
            key={i}
            className={`relative rounded-lg overflow-hidden border border-border bg-bg-secondary group ${
              isImage ? "w-14 h-14" : "h-14 px-2 flex items-center gap-1.5"
            }`}
          >
            {isImage ? (
              <SmartImage src={f.url} alt={f.file.name} fill className="object-cover" unoptimized />
            ) : (
              <>
                <span className="text-lg" aria-hidden>📄</span>
                <span className="text-[11px] font-body text-text-secondary max-w-[110px] truncate">
                  {f.file.name}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-[#1A1A1A]/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
              aria-label={`Retirer ${f.file.name}`}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useState } from "react";
import SmartImage from "@/components/ui/SmartImage";
import ImageLightbox from "./ImageLightbox";

export interface ChatAttachment {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

interface Props {
  attachments: ChatAttachment[];
  /** true = message envoyé par l'utilisateur (bulle sombre) → texte clair. */
  isSelf?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Rendu des pièces jointes d'un message dans une bulle de chat.
 *   - Image → miniature qui ouvre la lightbox en grand.
 *   - PDF   → chip cliquable qui télécharge le fichier (`download` attribut).
 *
 * L'attribut `download` sur le PDF empêche le viewer navigateur d'ouvrir le
 * document en inline — protection supplémentaire contre un PDF piégé.
 */
export default function ChatMessageAttachments({ attachments, isSelf = false }: Props) {
  const [zoomed, setZoomed] = useState<ChatAttachment | null>(null);

  if (!attachments || attachments.length === 0) return null;

  const textClass = isSelf ? "text-white/90 hover:text-white" : "text-text-secondary hover:text-text-primary";
  const chipClass = isSelf
    ? "bg-white/10 hover:bg-white/15 border border-white/20"
    : "bg-bg-primary hover:bg-bg-secondary border border-border";

  return (
    <>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {attachments.map((a) => {
          const isImage = a.mimeType.startsWith("image/");
          if (isImage) {
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setZoomed(a)}
                className="relative w-40 h-40 rounded-lg overflow-hidden border border-border/40 bg-black/10 hover:opacity-90 transition-opacity"
                aria-label={`Agrandir ${a.fileName}`}
              >
                <SmartImage src={a.filePath} alt={a.fileName} fill className="object-cover" />
              </button>
            );
          }
          return (
            <a
              key={a.id}
              href={a.filePath}
              download={a.fileName}
              rel="noopener noreferrer"
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 max-w-[240px] transition-colors ${chipClass} ${textClass}`}
            >
              <span className="text-base shrink-0" aria-hidden>📄</span>
              <span className="flex flex-col min-w-0">
                <span className="text-xs font-body truncate">{a.fileName}</span>
                <span className="text-[10px] opacity-70 font-body">{formatSize(a.fileSize)}</span>
              </span>
            </a>
          );
        })}
      </div>
      {zoomed && (
        <ImageLightbox
          src={zoomed.filePath}
          alt={zoomed.fileName}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}

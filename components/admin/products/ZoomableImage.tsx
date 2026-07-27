"use client";

/**
 * Image cliquable avec loupe au survol → ouvre l'image en grand dans une
 * modale plein écran (backdrop noir + clic pour fermer). Utilisée dans le
 * modal de liaison marketplace pour permettre de voir en détail chaque image
 * de produit / variante côté BJ et côté marketplace.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getImageSrc } from "@/lib/image-utils";

interface Props {
  src: string | null;
  alt?: string;
  /** Classes du thumbnail (contrôle la taille). */
  className?: string;
  /** Taille preview appliquée à l'URL (thumb/medium/large). */
  size?: "thumb" | "medium" | "large";
  /** Si vrai, l'URL src est déjà finale (marketplace) — pas de resize. */
  raw?: boolean;
}

export function ZoomableImage({
  src,
  alt = "",
  className = "w-16 h-16 rounded-lg object-cover border border-slate-200",
  size = "thumb",
  raw = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!src) {
    return (
      <div
        className={`bg-slate-100 flex items-center justify-center text-[10px] text-text-muted font-semibold shrink-0 ${className}`}
      >
        IMG
      </div>
    );
  }

  const finalSrc = raw ? src : getImageSrc(src, size);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative group shrink-0 focus:outline-none focus:ring-2 focus:ring-slate-900 rounded-lg overflow-hidden"
        aria-label="Voir l'image en grand"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={finalSrc} alt={alt} className={className} />
        <span
          aria-hidden
          className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/40 transition-colors flex items-center justify-center"
        >
          <svg
            className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M9.5 4a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM9.5 7v5M7 9.5h5"
            />
          </svg>
        </span>
      </button>

      {open &&
        mounted &&
        createPortal(
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out"
            aria-label="Fermer l'aperçu"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={raw ? src : getImageSrc(src, "large")}
              alt={alt}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <span
              className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/90 text-slate-900 flex items-center justify-center text-lg font-bold shadow-lg"
              aria-hidden
            >
              ✕
            </span>
          </button>,
          document.body,
        )}
    </>
  );
}
